#include <arpa/inet.h>
#include <errno.h>
#include <math.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MAX_CHANNELS 64
#define ADC_MAX 4095
#define HIST_BINS 64

typedef struct {
    int channel;
    double weight;
} ChannelWeight;

typedef struct {
    const char *host;
    int port;
    int channels;
    int dead_channel;
    bool has_dead_channel;
    double rate_hz;
    unsigned int seed;
    bool has_seed;
} Config;

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

static void parse_args(int argc, char **argv, Config *config) {
    config->host = "0.0.0.0";
    config->port = 9001;
    config->channels = 4;
    config->dead_channel = -1;
    config->has_dead_channel = false;
    config->rate_hz = 200.0;
    config->seed = 0;
    config->has_seed = false;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--host") == 0 && i + 1 < argc) {
            config->host = argv[++i];
        } else if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            config->port = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--channels") == 0 && i + 1 < argc) {
            config->channels = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--dead-channel") == 0 && i + 1 < argc) {
            config->dead_channel = atoi(argv[++i]);
            config->has_dead_channel = true;
        } else if (strcmp(argv[i], "--rate-hz") == 0 && i + 1 < argc) {
            config->rate_hz = atof(argv[++i]);
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            config->seed = (unsigned int)atoi(argv[++i]);
            config->has_seed = true;
        }
    }

    if (config->channels < 1) config->channels = 1;
    if (config->channels > MAX_CHANNELS) config->channels = MAX_CHANNELS;
}

static void init_channel_weights(ChannelWeight *weights, int channels, int dead_channel, bool has_dead_channel) {
    for (int i = 0; i < channels; i++) {
        weights[i].channel = i;
        if (has_dead_channel && i == dead_channel) {
            weights[i].weight = 0.0;
        } else {
            weights[i].weight = 0.5 + uniform_rand();
        }
    }
}

static int pick_channel(ChannelWeight *weights, int channels, double total_weight) {
    double r = uniform_rand() * total_weight;
    double accum = 0.0;
    for (int i = 0; i < channels; i++) {
        accum += weights[i].weight;
        if (r <= accum) {
            return weights[i].channel;
        }
    }
    return weights[channels - 1].channel;
}

static double compute_total_weight(ChannelWeight *weights, int channels) {
    double total = 0.0;
    for (int i = 0; i < channels; i++) {
        total += weights[i].weight;
    }
    return total;
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

int main(int argc, char **argv) {
    Config config;
    parse_args(argc, argv, &config);

    if (config.has_seed) {
        srand(config.seed);
    } else {
        srand((unsigned int)time(NULL));
    }

    ChannelWeight weights[MAX_CHANNELS];
    init_channel_weights(weights, config.channels, config.dead_channel, config.has_dead_channel);
    double total_weight = compute_total_weight(weights, config.channels);

    int server_fd = setup_server(config.host, config.port);
    printf("Simulator listening on %s:%d\n", config.host, config.port);
    if (config.has_dead_channel) {
        printf("Dead channel: %d\n", config.dead_channel);
    }
    log_rates(weights, config.channels, total_weight, config.rate_hz);

    struct sockaddr_in client_addr;
    socklen_t client_len = sizeof(client_addr);
    int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_len);
    if (client_fd < 0) {
        perror("accept");
        close(server_fd);
        return 1;
    }

    char client_ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
    printf("Client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));

    double interval_s = 1.0 / config.rate_hz;
    long long t_us = now_us();

    while (1) {
        int channel = pick_channel(weights, config.channels, total_weight);

        bool is_g_event = uniform_rand() < 0.35;
        bool trg_x = uniform_rand() < 0.2;
        bool trg_g = uniform_rand() < 0.15;
        bool no_data = uniform_rand() < 0.005;

        double base_mean = is_g_event ? 2400.0 : 1800.0;
        double base_std = is_g_event ? 250.0 : 180.0;
        int adc_x = clamp_adc((int)round(normal_rand(base_mean, base_std)));
        int adc_gtop = clamp_adc((int)round(normal_rand(base_mean + 120.0, base_std + 20.0)));
        int adc_gbot = clamp_adc((int)round(normal_rand(base_mean - 120.0, base_std + 25.0)));

        if (uniform_rand() < 0.08) {
            adc_x = clamp_adc((int)round(normal_rand(300.0, 120.0)));
        }
        if (uniform_rand() < 0.08) {
            adc_gtop = clamp_adc((int)round(normal_rand(350.0, 130.0)));
        }
        if (uniform_rand() < 0.08) {
            adc_gbot = clamp_adc((int)round(normal_rand(280.0, 110.0)));
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

        ssize_t sent = send(client_fd, buffer, (size_t)len, 0);
        if (sent <= 0) {
            perror("send");
            break;
        }

        t_us += (long long)(interval_s * 1000000.0);

        struct timespec req;
        req.tv_sec = (time_t)interval_s;
        req.tv_nsec = (long)((interval_s - req.tv_sec) * 1e9);
        nanosleep(&req, NULL);
    }

    printf("Client disconnected\n");
    close(client_fd);
    close(server_fd);
    return 0;
}
