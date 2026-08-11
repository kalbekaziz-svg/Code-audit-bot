require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const winston = require('winston');
const path = require('path');

// Initialize Winston logger
const logger = winston.createLogger({
    transports: [
        new winston.transports.File({ filename: 'logs/audit.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// Ensure logs directory exists
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

// Bot and Ollama configuration
const bot = new Telegraf(process.env.BOT_TOKEN);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL_NAME = 'qwen2.5-coder:7b'; 
const ALLOWED_EXTENSIONS = ['.js', '.py', '.php', '.java', '.cpp', '.c', '.html', '.css', '.json'];

// Function to analyze code using local Ollama model
async function analyzeCode(code) {
    try {
        const response = await axios.post(OLLAMA_URL, {
            model: MODEL_NAME,
            prompt: `You are an elite AI Code Auditor and Senior Penetration Tester. Analyze this code for vulnerabilities, explain the risks, and provide secure code fixes:\n\n${code}`,
            stream: false
        });
        return response.data.response;
    } catch (error) {
        logger.error(`Ollama API Error: ${error.message}`);
        throw new Error('Failed to connect to the local AI server.');
    }
}

// Start command handler
bot.start((ctx) => {
    logger.info(`User ${ctx.from.id} started the bot`);
    ctx.reply(
        "Welcome to CodeAuditBot 🛡️\n\n" +
        "Send me a code file (.js, .py, .php, etc.) and I will perform a security audit."
    );
});

// Handle incoming code documents/files
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const ext = path.extname(doc.file_name).toLowerCase();

    // Validate file extension
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return ctx.reply('❌ Unsupported file type. Please upload a valid source code file.');
    }

    try {
        logger.info(`User ${ctx.from.id} uploaded file: ${doc.file_name}`);
        
        // Fetch file link and download content
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const codeContent = Buffer.from(response.data).toString('utf-8');

        ctx.reply('🔍 Analyzing code for vulnerabilities...');
        
        // Run AI code audit
        const analysis = await analyzeCode(codeContent);
        
        logger.info(`Successfully analyzed file: ${doc.file_name}`);
        ctx.reply(analysis);
    } catch (err) {
        logger.error(`Processing error for user ${ctx.from.id}: ${err.message}`);
        ctx.reply('⚠️ An error occurred while analyzing the file.');
    }
});

// Launch the bot with error handling
bot.launch().then(() => {
    logger.info('CodeAuditBot has successfully started...');
    console.log('CodeAuditBot is running...');
}).catch((err) => {
    logger.error(`Critical startup error: ${err.message}`);
    console.error(`Error: ${err.message}`);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));