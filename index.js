require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Initialize Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/audit.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// Ensure logs directory exists
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL_NAME = 'qwen2.5:7b';
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB limit

bot.start((ctx) => {
    logger.info(`User ${ctx.from.id} started the bot`);
    ctx.reply(
        "Welcome to CodeAuditBot 🛡️\n\n" +
        "Send me a code file (.js, .py, .php, etc.) and I will perform an automated Static Application Security Testing (SAST) analysis, find vulnerabilities, and suggest secure alternatives."
    );
});

bot.on('document', async (ctx) => {
    const document = ctx.message.document;
    logger.info(`User ${ctx.from.id} uploaded file: ${document.file_name}, size: ${document.file_size} bytes`);

    if (document.file_size > MAX_FILE_SIZE) {
        return ctx.reply("❌ File is too large. Maximum file size allowed is 1 MB.");
    }

    try {
        await ctx.reply("⏳ Downloading and analyzing code for security flaws...");

        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'text' });
        const codeContent = response.data;

        const prompt = `You are an expert Application Security Engineer and SAST tool. Analyze the following source code file (${document.file_name}) for security vulnerabilities (such as SQL injections, XSS, insecure deserialization, secret leaks, or logic errors). 

Structure your response clearly:
1. Vulnerabilities found (with explanation)
2. Secure code alternative (with code snippets)
3. Additional security recommendations

Source code:
\`\`\`
${codeContent}
\`\`\``;

        logger.info(`Sending request to Ollama for file: ${document.file_name}`);

        const ollamaResponse = await axios.post(OLLAMA_URL, {
            model: MODEL_NAME,
            prompt: prompt,
            stream: false
        });

        const analysisResult = ollamaResponse.data.response;
        logger.info(`Successfully analyzed file: ${document.file_name}`);

        // Telegram has a 4096 character limit per message, splitting if necessary
        if (analysisResult.length > 4000) {
            const chunks = analysisResult.match(/[\s\S]{1,4000}/g);
            for (const chunk of chunks) {
                await ctx.reply(chunk);
            }
        } else {
            await ctx.reply(analysisResult);
        }

    } catch (error) {
        logger.error(`Error processing file from user ${ctx.from.id}: ${error.message}`);
        ctx.reply("❌ An error occurred while processing your file. Please try again later.");
    }
});

bot.launch().then(() => {
    logger.info("CodeAuditBot has successfully started.");
    console.log("CodeAuditBot is running...");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));