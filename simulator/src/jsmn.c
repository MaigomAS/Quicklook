#include "jsmn.h"

static jsmntok_t *jsmn_alloc_token(jsmn_parser *parser, jsmntok_t *tokens, size_t num_tokens) {
    if (parser->toknext >= num_tokens) {
        return NULL;
    }
    jsmntok_t *tok = &tokens[parser->toknext++];
    tok->start = tok->end = -1;
    tok->size = 0;
    tok->parent = -1;
    tok->type = JSMN_UNDEFINED;
    return tok;
}

static void jsmn_fill_token(jsmntok_t *token, jsmntype_t type, int start, int end) {
    token->type = type;
    token->start = start;
    token->end = end;
    token->size = 0;
}

static int jsmn_parse_primitive(jsmn_parser *parser, const char *js, size_t len,
                                jsmntok_t *tokens, size_t num_tokens) {
    int start = parser->pos;
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        if (c == '\t' || c == '\r' || c == '\n' || c == ' ' || c == ',' || c == ']' || c == '}') {
            break;
        }
        if (c < 32 || c >= 127) {
            parser->pos = start;
            return -1;
        }
    }

    jsmntok_t *token = jsmn_alloc_token(parser, tokens, num_tokens);
    if (token == NULL) {
        parser->pos = start;
        return -1;
    }
    jsmn_fill_token(token, JSMN_PRIMITIVE, start, parser->pos);
    token->parent = parser->toksuper;
    parser->pos--;
    return 0;
}

static int jsmn_parse_string(jsmn_parser *parser, const char *js, size_t len,
                             jsmntok_t *tokens, size_t num_tokens) {
    int start = parser->pos;
    parser->pos++;
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        if (c == '"') {
            jsmntok_t *token = jsmn_alloc_token(parser, tokens, num_tokens);
            if (token == NULL) {
                parser->pos = start;
                return -1;
            }
            jsmn_fill_token(token, JSMN_STRING, start + 1, parser->pos);
            token->parent = parser->toksuper;
            return 0;
        }
        if (c == '\\' && parser->pos + 1 < len) {
            parser->pos++;
        }
    }
    parser->pos = start;
    return -1;
}

void jsmn_init(jsmn_parser *parser) {
    parser->pos = 0;
    parser->toknext = 0;
    parser->toksuper = -1;
}

int jsmn_parse(jsmn_parser *parser, const char *js, size_t len, jsmntok_t *tokens, unsigned int num_tokens) {
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        switch (c) {
            case '{':
            case '[': {
                jsmntok_t *token = jsmn_alloc_token(parser, tokens, num_tokens);
                if (token == NULL) {
                    return -1;
                }
                token->type = (c == '{' ? JSMN_OBJECT : JSMN_ARRAY);
                token->start = parser->pos;
                token->parent = parser->toksuper;
                parser->toksuper = (int)(parser->toknext - 1);
                break;
            }
            case '}':
            case ']': {
                jsmntype_t type = (c == '}' ? JSMN_OBJECT : JSMN_ARRAY);
                for (int i = (int)parser->toknext - 1; i >= 0; i--) {
                    jsmntok_t *token = &tokens[i];
                    if (token->start != -1 && token->end == -1) {
                        if (token->type != type) {
                            return -1;
                        }
                        token->end = parser->pos + 1;
                        parser->toksuper = token->parent;
                        break;
                    }
                }
                break;
            }
            case '"':
                if (jsmn_parse_string(parser, js, len, tokens, num_tokens) != 0) {
                    return -1;
                }
                break;
            case '\t':
            case '\r':
            case '\n':
            case ' ':
            case ':':
            case ',':
                break;
            default:
                if (jsmn_parse_primitive(parser, js, len, tokens, num_tokens) != 0) {
                    return -1;
                }
                break;
        }
    }

    for (int i = (int)parser->toknext - 1; i >= 0; i--) {
        if (tokens[i].start != -1 && tokens[i].end == -1) {
            return -1;
        }
    }

    return (int)parser->toknext;
}
