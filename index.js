require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const winston = require('winston');
const path = require('path');

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_CODE_LENGTH = 200000;
const DEFAULT_OLLAMA_TIMEOUT_MS = 180000;
const DEFAULT_OLLAMA_NUM_PREDICT = 800;
const LOG_DIR = path.join(__dirname, 'logs');
const ALLOWED_EXTENSIONS = ['.js', '.py', '.php', '.java', '.cpp', '.c', '.html', '.css', '.json'];

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logger = winston.createLogger({
    transports: [
        new winston.transports.File({ filename: path.join(LOG_DIR, 'audit.log') }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

function validateBotConfig() {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken || !botToken.trim()) {
        throw new Error('BOT_TOKEN is required. Add it to your .env file.');
    }

    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
    if (!/^https?:\/\//i.test(ollamaUrl)) {
        throw new Error('OLLAMA_URL must be a valid http(s) URL.');
    }

    return {
        botToken: botToken.trim(),
        ollamaUrl,
        modelName: process.env.MODEL_NAME || 'qwen2.5-coder:7b'
    };
}

function validateFileSize(fileSizeBytes) {
    const size = Number(fileSizeBytes || 0);

    if (!Number.isFinite(size) || size < 0) {
        throw new Error('Invalid file size.');
    }

    if (size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File exceeds the maximum allowed size of 2 MB.`);
    }

    return size;
}

function sanitizeSourceCode(code = '') {
    return String(code || '').slice(0, MAX_CODE_LENGTH);
}

function positiveIntegerEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function analyzeCode(code, modelName, ollamaUrl) {
    const safeCode = sanitizeSourceCode(code);

    try {
        const response = await axios.post(
            ollamaUrl,
            {
                model: modelName,
                prompt: `You are an elite AI Code Auditor and Senior Penetration Tester. Analyze this code for vulnerabilities, explain the risks, and provide secure code fixes:\n\n${safeCode}`,
                stream: false,
                options: {
                    num_predict: positiveIntegerEnv('OLLAMA_NUM_PREDICT', DEFAULT_OLLAMA_NUM_PREDICT)
                }
            },
            {
                timeout: positiveIntegerEnv('OLLAMA_TIMEOUT_MS', DEFAULT_OLLAMA_TIMEOUT_MS),
                validateStatus: (status) => status >= 200 && status < 300
            }
        );

        if (!response?.data?.response) {
            throw new Error('The AI service returned an empty response.');
        }

        return response.data.response;
    } catch (error) {
        const detail = error.code === 'ECONNABORTED'
            ? `request exceeded ${positiveIntegerEnv('OLLAMA_TIMEOUT_MS', DEFAULT_OLLAMA_TIMEOUT_MS)}ms`
            : error.message;
        logger.error(`Ollama API Error: ${detail}`);
        throw new Error('Failed to connect to the local AI server.');
    }
}

function startBot() {
    const config = validateBotConfig();
    const bot = new Telegraf(config.botToken);

    bot.start((ctx) => {
        logger.info(`User ${ctx.from.id} started the bot`);
        ctx.reply(
            'Welcome to CodeAuditBot 🛡️\n\n' +
            'Send me a code file (.js, .py, .php, etc.) and I will perform a security audit.'
        );
    });

    bot.catch((err, ctx) => {
        logger.error(`Unhandled bot error for chat ${ctx?.chat?.id}: ${err.message}`);
        ctx.reply('⚠️ An unexpected error occurred while processing your request.');
    });

    bot.on('document', async (ctx) => {
        const doc = ctx.message.document;
        const ext = path.extname(doc.file_name || '').toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return ctx.reply('❌ Unsupported file type. Please upload a valid source code file.');
        }

        try {
            validateFileSize(doc.file_size);
            logger.info(`User ${ctx.from.id} uploaded file: ${doc.file_name}`);

            const fileLink = await ctx.telegram.getFileLink(doc.file_id);
            const response = await axios.get(fileLink.href, {
                responseType: 'arraybuffer',
                timeout: 15000
            });

            const codeContent = sanitizeSourceCode(Buffer.from(response.data).toString('utf-8'));
            if (!codeContent.trim()) {
                return ctx.reply('❌ The uploaded file is empty.');
            }

            ctx.reply('🔍 Analyzing code for vulnerabilities...');
            const analysis = await analyzeCode(codeContent, config.modelName, config.ollamaUrl);

            logger.info(`Successfully analyzed file: ${doc.file_name}`);
            ctx.reply(analysis);
        } catch (err) {
            logger.error(`Processing error for user ${ctx.from.id}: ${err.message}`);
            ctx.reply('⚠️ An error occurred while analyzing the file.');
        }
    });

    bot.launch().then(() => {
        logger.info('CodeAuditBot has successfully started...');
        console.log('CodeAuditBot is running...');
    }).catch((err) => {
        logger.error(`Critical startup error: ${err.message}`);
        console.error(`Error: ${err.message}`);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    return bot;
}

if (require.main === module) {
    startBot();
}

module.exports = {
    validateBotConfig,
    validateFileSize,
    sanitizeSourceCode,
    startBot,
    MAX_FILE_SIZE_BYTES,
    MAX_CODE_LENGTH
};
