#include <arpa/inet.h>
#include <errno.h>
#include <math.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include "jsmn.h"

#define MAX_CHANNELS 64
#define ADC_MAX 4095
#define HIST_BINS 64
#define OUT_BUFFER_SIZE 8192
#define JSON_TOKENS 512
#define BURST_INTERVAL_S 12
#define BURST_DURATION_S 3
#define BURST_MULTIPLIER 3.5
#define BURST_CHANNEL_FRACTION 0.25

typedef struct {
    int channel;
    double weight;
} ChannelWeight;

typedef struct {
    double g_mean;
    double g_std;
    double x_mean;
    double x_std;
    double gtop_offset;
    double gbot_offset;
    double gtop_std_offset;
    double gbot_std_offset;
    double low_prob;
    double low_mean;
    double low_std;
    double no_data_prob;
    double trg_x_prob;
    double trg_g_prob;
    double g_event_prob;
} DistributionConfig;

typedef struct {
    const char *host;
    int port;
    int channels;
    double rate_hz;
    unsigned int seed;
    bool has_seed;
    bool dead_channels[MAX_CHANNELS];
    double rate_multipliers[MAX_CHANNELS];
    bool has_rate_multipliers;
    bool burst_mode;
    double drop_rate;
    int stats_interval_s;
    const char *config_path;
    DistributionConfig dist;
} Config;

static volatile sig_atomic_t stop_requested = 0;

static void handle_signal(int sig) {
    (void)sig;
    stop_requested = 1;
}

static double uniform_rand(void) {
    return (double)rand() / (double)RAND_MAX;
}

static double normal_rand(double mean, double stddev) {
    double u1 = uniform_rand();
    double u2 = uniform_rand();
    double mag = sqrt(-2.0 * log(u1 + 1e-9));
    double z0 = mag * cos(2.0 * M_PI * u2);
    return mean + z0 * stddev;
}

static int clamp_adc(int value) {
    if (value < 0) return 0;
    if (value > ADC_MAX) return ADC_MAX;
    return value;
}

static void init_distribution(DistributionConfig *dist) {
    dist->g_mean = 2400.0;
    dist->g_std = 250.0;
    dist->x_mean = 1800.0;
    dist->x_std = 180.0;
    dist->gtop_offset = 120.0;
    dist->gbot_offset = -120.0;
    dist->gtop_std_offset = 20.0;
    dist->gbot_std_offset = 25.0;
    dist->low_prob = 0.08;
    dist->low_mean = 300.0;
    dist->low_std = 120.0;
    dist->no_data_prob = 0.005;
    dist->trg_x_prob = 0.2;
    dist->trg_g_prob = 0.15;
    dist->g_event_prob = 0.35;
}

static void init_config(Config *config) {
    config->host = "0.0.0.0";
    config->port = 9001;
    config->channels = 4;
    config->rate_hz = 200.0;
    config->seed = 0;
    config->has_seed = false;
    memset(config->dead_channels, 0, sizeof(config->dead_channels));
    for (int i = 0; i < MAX_CHANNELS; i++) {
        config->rate_multipliers[i] = 1.0;
    }
    config->has_rate_multipliers = false;
    config->burst_mode = false;
    config->drop_rate = 0.0;
    config->stats_interval_s = 5;
    config->config_path = NULL;
    init_distribution(&config->dist);
}

static const char *read_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        return NULL;
    }
    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return NULL;
    }
    long size = ftell(fp);
    if (size < 0) {
        fclose(fp);
        return NULL;
    }
    rewind(fp);
    char *buffer = (char *)malloc((size_t)size + 1);
    if (!buffer) {
        fclose(fp);
        return NULL;
    }
    size_t read_size = fread(buffer, 1, (size_t)size, fp);
    fclose(fp);
    buffer[read_size] = '\0';
    if (out_len) {
        *out_len = read_size;
    }
    return buffer;
}

static int json_token_eq(const char *json, jsmntok_t *tok, const char *s) {
    size_t len = (size_t)(tok->end - tok->start);
    return tok->type == JSMN_STRING && strlen(s) == len && strncmp(json + tok->start, s, len) == 0;
}

static double json_token_to_double(const char *json, jsmntok_t *tok) {
    char buf[64];
    int len = tok->end - tok->start;
    if (len <= 0 || len >= (int)sizeof(buf)) {
        return 0.0;
    }
    memcpy(buf, json + tok->start, (size_t)len);
    buf[len] = '\0';
    return atof(buf);
}

static int json_token_to_int(const char *json, jsmntok_t *tok) {
    return (int)json_token_to_double(json, tok);
}

static int json_token_span(jsmntok_t *tokens, int index) {
    jsmntok_t *tok = &tokens[index];
    int span = 1;
    if (tok->type == JSMN_ARRAY) {
        int offset = index + 1;
        for (int i = 0; i < tok->size; i++) {
            int child_span = json_token_span(tokens, offset);
            span += child_span;
            offset += child_span;
        }
    } else if (tok->type == JSMN_OBJECT) {
        int offset = index + 1;
        for (int i = 0; i < tok->size; i++) {
            int key_span = json_token_span(tokens, offset);
            offset += key_span;
            int val_span = json_token_span(tokens, offset);
            offset += val_span;
            span += key_span + val_span;
        }
    }
    return span;
}

static int json_find_key(const char *json, jsmntok_t *tokens, int count, int obj_index, const char *key) {
    if (obj_index < 0 || obj_index >= count) {
        return -1;
    }
    jsmntok_t *obj = &tokens[obj_index];
    if (obj->type != JSMN_OBJECT) {
        return -1;
    }
    int i = obj_index + 1;
    for (int pair = 0; pair < obj->size; pair++) {
        jsmntok_t *key_tok = &tokens[i];
        jsmntok_t *val_tok = &tokens[i + 1];
        if (json_token_eq(json, key_tok, key)) {
            return i + 1;
        }
        i += 1 + json_token_span(tokens, i + 1);
    }
    return -1;
}

static int json_array_len(jsmntok_t *tok) {
    if (tok->type != JSMN_ARRAY) {
        return 0;
    }
    return tok->size;
}

static void apply_distribution_config(const char *json, jsmntok_t *tokens, int count, int obj_index, DistributionConfig *dist) {
    if (obj_index < 0 || obj_index >= count) {
        return;
    }
    jsmntok_t *obj = &tokens[obj_index];
    if (obj->type != JSMN_OBJECT) {
        return;
    }
    int i = obj_index + 1;
    for (int pair = 0; pair < obj->size; pair++) {
        jsmntok_t *key_tok = &tokens[i];
        jsmntok_t *val_tok = &tokens[i + 1];
        if (json_token_eq(json, key_tok, "g_mean")) {
            dist->g_mean = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "g_std")) {
            dist->g_std = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "x_mean")) {
            dist->x_mean = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "x_std")) {
            dist->x_std = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "gtop_offset")) {
            dist->gtop_offset = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "gbot_offset")) {
            dist->gbot_offset = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "gtop_std_offset")) {
            dist->gtop_std_offset = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "gbot_std_offset")) {
            dist->gbot_std_offset = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "low_prob")) {
            dist->low_prob = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "low_mean")) {
            dist->low_mean = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "low_std")) {
            dist->low_std = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "no_data_prob")) {
            dist->no_data_prob = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "trg_x_prob")) {
            dist->trg_x_prob = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "trg_g_prob")) {
            dist->trg_g_prob = json_token_to_double(json, val_tok);
        } else if (json_token_eq(json, key_tok, "g_event_prob")) {
            dist->g_event_prob = json_token_to_double(json, val_tok);
        }
        i += 1 + json_token_span(tokens, i + 1);
    }
}

static void apply_config_file(Config *config, const char *path) {
    size_t len = 0;
    const char *json = read_file(path, &len);
    if (!json) {
        fprintf(stderr, "Failed to read config file: %s\n", path);
        exit(1);
    }
    jsmn_parser parser;
    jsmn_init(&parser);
    jsmntok_t tokens[JSON_TOKENS];
    int count = jsmn_parse(&parser, json, len, tokens, JSON_TOKENS);
    if (count < 0 || tokens[0].type != JSMN_OBJECT) {
        fprintf(stderr, "Invalid JSON config: %s\n", path);
        free((void *)json);
        exit(1);
    }

    int val_index = json_find_key(json, tokens, count, 0, "channels");
    if (val_index >= 0) {
        config->channels = json_token_to_int(json, &tokens[val_index]);
    }
    val_index = json_find_key(json, tokens, count, 0, "rate_hz");
    if (val_index >= 0) {
        config->rate_hz = json_token_to_double(json, &tokens[val_index]);
    }
    val_index = json_find_key(json, tokens, count, 0, "dead_channels");
    if (val_index >= 0 && tokens[val_index].type == JSMN_ARRAY) {
        memset(config->dead_channels, 0, sizeof(config->dead_channels));
        int arr_len = json_array_len(&tokens[val_index]);
        int idx = val_index + 1;
        for (int i = 0; i < arr_len; i++) {
            int ch = json_token_to_int(json, &tokens[idx + i]);
            if (ch >= 0 && ch < MAX_CHANNELS) {
                config->dead_channels[ch] = true;
            }
        }
    }
    val_index = json_find_key(json, tokens, count, 0, "rate_multipliers");
    if (val_index >= 0 && tokens[val_index].type == JSMN_ARRAY) {
        config->has_rate_multipliers = true;
        int arr_len = json_array_len(&tokens[val_index]);
        int idx = val_index + 1;
        for (int i = 0; i < MAX_CHANNELS; i++) {
            config->rate_multipliers[i] = 1.0;
        }
        for (int i = 0; i < arr_len && i < MAX_CHANNELS; i++) {
            config->rate_multipliers[i] = json_token_to_double(json, &tokens[idx + i]);
        }
    }
    val_index = json_find_key(json, tokens, count, 0, "distribution");
    if (val_index >= 0) {
        apply_distribution_config(json, tokens, count, val_index, &config->dist);
    }

    free((void *)json);
}

static void parse_args(int argc, char **argv, Config *config) {
    init_config(config);

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--host") == 0 && i + 1 < argc) {
            config->host = argv[++i];
        } else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            config->port = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--channels") == 0 && i + 1 < argc) {
            config->channels = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--dead-channel") == 0 && i + 1 < argc) {
            int ch = atoi(argv[++i]);
            if (ch >= 0 && ch < MAX_CHANNELS) {
                config->dead_channels[ch] = true;
            }
        } else if (strcmp(argv[i], "--rate-hz") == 0 && i + 1 < argc) {
            config->rate_hz = atof(argv[++i]);
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            config->seed = (unsigned int)atoi(argv[++i]);
            config->has_seed = true;
        } else if (strcmp(argv[i], "--config") == 0 && i + 1 < argc) {
            config->config_path = argv[++i];
            apply_config_file(config, config->config_path);
        } else if (strcmp(argv[i], "--burst-mode") == 0 && i + 1 < argc) {
            const char *mode = argv[++i];
            config->burst_mode = strcmp(mode, "on") == 0;
        } else if (strcmp(argv[i], "--drop-rate") == 0 && i + 1 < argc) {
            config->drop_rate = atof(argv[++i]);
        } else if (strcmp(argv[i], "--stats-interval") == 0 && i + 1 < argc) {
            config->stats_interval_s = atoi(argv[++i]);
        }
    }

    if (config->channels < 1) config->channels = 1;
    if (config->channels > MAX_CHANNELS) config->channels = MAX_CHANNELS;
    if (config->drop_rate < 0.0) config->drop_rate = 0.0;
    if (config->drop_rate > 1.0) config->drop_rate = 1.0;
    if (config->stats_interval_s < 1) config->stats_interval_s = 1;
}

static void init_channel_weights(ChannelWeight *weights, Config *config) {
    for (int i = 0; i < config->channels; i++) {
        weights[i].channel = i;
        if (config->dead_channels[i]) {
            weights[i].weight = 0.0;
        } else if (config->has_rate_multipliers) {
            weights[i].weight = config->rate_multipliers[i];
        } else {
            weights[i].weight = 0.5 + uniform_rand();
        }
    }
}

static double compute_total_weight(ChannelWeight *weights, int channels, bool *burst_channels, bool burst_active) {
    double total = 0.0;
    for (int i = 0; i < channels; i++) {
        double weight = weights[i].weight;
        if (burst_active && burst_channels[i]) {
            weight *= BURST_MULTIPLIER;
        }
        total += weight;
    }
    return total;
}

static int pick_channel(ChannelWeight *weights, int channels, double total_weight, bool *burst_channels, bool burst_active) {
    double r = uniform_rand() * total_weight;
    double accum = 0.0;
    for (int i = 0; i < channels; i++) {
        double weight = weights[i].weight;
        if (burst_active && burst_channels[i]) {
            weight *= BURST_MULTIPLIER;
        }
        accum += weight;
        if (r <= accum) {
            return weights[i].channel;
        }
    }
    return weights[channels - 1].channel;
}

static int setup_server(const char *host, int port) {
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        exit(1);
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    if (inet_pton(AF_INET, host, &addr.sin_addr) <= 0) {
        perror("inet_pton");
        close(server_fd);
        exit(1);
    }

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(server_fd);
        exit(1);
    }

    if (listen(server_fd, 1) < 0) {
        perror("listen");
        close(server_fd);
        exit(1);
    }

    return server_fd;
}

static long long now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000000LL + ts.tv_nsec / 1000LL;
}

static void log_rates(ChannelWeight *weights, int channels, double total_weight, double rate_hz) {
    printf("Effective per-channel rates (Hz):\n");
    for (int i = 0; i < channels; i++) {
        double rate = total_weight > 0.0 ? (weights[i].weight / total_weight) * rate_hz : 0.0;
        printf("  ch %d: %.2f\n", weights[i].channel, rate);
    }
}

static ssize_t send_all(int fd, const char *buffer, size_t len) {
    size_t total = 0;
    while (total < len) {
        ssize_t sent = send(fd, buffer + total, len - total, 0);
        if (sent < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (sent == 0) {
            break;
        }
        total += (size_t)sent;
    }
    return (ssize_t)total;
}

static void flush_out_buffer(int fd, char *out_buffer, size_t *out_len) {
    if (*out_len == 0) {
        return;
    }
    if (send_all(fd, out_buffer, *out_len) < 0) {
        perror("send");
    }
    *out_len = 0;
}

static void print_stats_header(void) {
    printf("Stats: elapsed_s sent_rate_hz sent dropped per_channel_counts\n");
}

static void print_stats(double elapsed_s, unsigned long long sent_delta, unsigned long long dropped_delta, int *counts, int channels) {
    double rate = elapsed_s > 0.0 ? (double)sent_delta / elapsed_s : 0.0;
    printf("Stats: %.2f %.2f %llu %llu", elapsed_s, rate, sent_delta, dropped_delta);
    for (int i = 0; i < channels; i++) {
        printf(" ch%d=%d", i, counts[i]);
    }
    printf("\n");
}

static void choose_burst_channels(bool *burst_channels, int channels) {
    int burst_count = (int)ceil(channels * BURST_CHANNEL_FRACTION);
    if (burst_count < 1) {
        burst_count = 1;
    }
    for (int i = 0; i < channels; i++) {
        burst_channels[i] = false;
    }
    for (int i = 0; i < burst_count; i++) {
        int ch = rand() % channels;
        burst_channels[ch] = true;
    }
}

int main(int argc, char **argv) {
    Config config;
    parse_args(argc, argv, &config);

    if (config.has_seed) {
        srand(config.seed);
    } else {
        srand((unsigned int)time(NULL));
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    ChannelWeight weights[MAX_CHANNELS];
    init_channel_weights(weights, &config);

    bool burst_channels[MAX_CHANNELS];
    for (int i = 0; i < MAX_CHANNELS; i++) {
        burst_channels[i] = false;
    }
    double total_weight = compute_total_weight(weights, config.channels, burst_channels, false);

    int server_fd = setup_server(config.host, config.port);
    printf("Simulator listening on %s:%d\n", config.host, config.port);
    if (config.config_path) {
        printf("Config: %s\n", config.config_path);
    }
    log_rates(weights, config.channels, total_weight, config.rate_hz);

    struct sockaddr_in client_addr;
    socklen_t client_len = sizeof(client_addr);
    int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_len);
    if (client_fd < 0) {
        if (errno == EINTR) {
            close(server_fd);
            return 0;
        }
        perror("accept");
        close(server_fd);
        return 1;
    }

    char client_ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
    printf("Client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));

    double interval_s = 1.0 / config.rate_hz;
    long long t_us = now_us();
    long long last_stats_us = now_us();
    long long next_burst_us = now_us() + (long long)BURST_INTERVAL_S * 1000000LL;
    long long burst_end_us = 0;
    bool burst_active = false;

    unsigned long long sent_total = 0;
    unsigned long long dropped_total = 0;
    unsigned long long sent_interval = 0;
    unsigned long long dropped_interval = 0;
    int counts_interval[MAX_CHANNELS];
    for (int i = 0; i < MAX_CHANNELS; i++) {
        counts_interval[i] = 0;
    }
    print_stats_header();

    char out_buffer[OUT_BUFFER_SIZE];
    size_t out_len = 0;

    while (!stop_requested) {
        long long now = now_us();
        if (config.burst_mode && !burst_active && now >= next_burst_us) {
            burst_active = true;
            burst_end_us = now + (long long)BURST_DURATION_S * 1000000LL;
            choose_burst_channels(burst_channels, config.channels);
            total_weight = compute_total_weight(weights, config.channels, burst_channels, true);
        }
        if (burst_active && now >= burst_end_us) {
            burst_active = false;
            next_burst_us = now + (long long)BURST_INTERVAL_S * 1000000LL;
            total_weight = compute_total_weight(weights, config.channels, burst_channels, false);
        }

        int channel = pick_channel(weights, config.channels, total_weight, burst_channels, burst_active);

        bool is_g_event = uniform_rand() < config.dist.g_event_prob;
        bool trg_x = uniform_rand() < config.dist.trg_x_prob;
        bool trg_g = uniform_rand() < config.dist.trg_g_prob;
        bool no_data = uniform_rand() < config.dist.no_data_prob;

        double base_mean = is_g_event ? config.dist.g_mean : config.dist.x_mean;
        double base_std = is_g_event ? config.dist.g_std : config.dist.x_std;
        int adc_x = clamp_adc((int)round(normal_rand(base_mean, base_std)));
        int adc_gtop = clamp_adc((int)round(normal_rand(base_mean + config.dist.gtop_offset, base_std + config.dist.gtop_std_offset)));
        int adc_gbot = clamp_adc((int)round(normal_rand(base_mean + config.dist.gbot_offset, base_std + config.dist.gbot_std_offset)));

        if (uniform_rand() < config.dist.low_prob) {
            adc_x = clamp_adc((int)round(normal_rand(config.dist.low_mean, config.dist.low_std)));
        }
        if (uniform_rand() < config.dist.low_prob) {
            adc_gtop = clamp_adc((int)round(normal_rand(config.dist.low_mean + 50.0, config.dist.low_std + 10.0)));
        }
        if (uniform_rand() < config.dist.low_prob) {
            adc_gbot = clamp_adc((int)round(normal_rand(config.dist.low_mean - 20.0, config.dist.low_std - 10.0)));
        }

        if (no_data) {
            adc_x = 0;
            adc_gtop = 0;
            adc_gbot = 0;
        }

        char buffer[512];
        int len = snprintf(
            buffer,
            sizeof(buffer),
            "{\"t_us\":%lld,\"channel\":%d,\"adc_x\":%d,\"adc_gtop\":%d,\"adc_gbot\":%d,"
            "\"flags\":{\"trg_x\":%s,\"trg_g\":%s,\"no_data\":%s,\"is_g_event\":%s}}\n",
            t_us,
            channel,
            adc_x,
            adc_gtop,
            adc_gbot,
            trg_x ? "true" : "false",
            trg_g ? "true" : "false",
            no_data ? "true" : "false",
            is_g_event ? "true" : "false");

        bool dropped = uniform_rand() < config.drop_rate;
        if (!dropped) {
            if ((size_t)len > sizeof(out_buffer)) {
                flush_out_buffer(client_fd, out_buffer, &out_len);
                if (send_all(client_fd, buffer, (size_t)len) < 0) {
                    perror("send");
                    break;
                }
            } else {
                if (out_len + (size_t)len > sizeof(out_buffer)) {
                    flush_out_buffer(client_fd, out_buffer, &out_len);
                }
                memcpy(out_buffer + out_len, buffer, (size_t)len);
                out_len += (size_t)len;
            }
            sent_total++;
            sent_interval++;
            if (channel >= 0 && channel < config.channels) {
                counts_interval[channel] += 1;
            }
        } else {
            dropped_total++;
            dropped_interval++;
        }

        t_us += (long long)(interval_s * 1000000.0);

        struct timespec req;
        req.tv_sec = (time_t)interval_s;
        req.tv_nsec = (long)((interval_s - req.tv_sec) * 1e9);
        nanosleep(&req, NULL);

        long long now_stats = now_us();
        if (now_stats - last_stats_us >= (long long)config.stats_interval_s * 1000000LL) {
            double elapsed_s = (now_stats - last_stats_us) / 1000000.0;
            print_stats(elapsed_s, sent_interval, dropped_interval, counts_interval, config.channels);
            last_stats_us = now_stats;
            sent_interval = 0;
            dropped_interval = 0;
            for (int i = 0; i < config.channels; i++) {
                counts_interval[i] = 0;
            }
            flush_out_buffer(client_fd, out_buffer, &out_len);
        }
    }

    flush_out_buffer(client_fd, out_buffer, &out_len);
    printf("\nFinal summary: sent=%llu dropped=%llu\n", sent_total, dropped_total);
    printf("Client disconnected\n");
    close(client_fd);
    close(server_fd);
    return 0;
}
