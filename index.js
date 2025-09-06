const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const wav = require('node-wav');
const os = require('os');
const { execFileSync } = require('child_process');
const https = require('https');
const WhatsAppClient = require('./whatsapp_client');
const messageTemplates = require('./message_templates');
const http = require('http');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const config = require('./config');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const puppeteer = require('puppeteer-extra');
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://elylqdcfhcasamdjjusn.supabase.co';
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVseWxxZGNmaGNhc2FtZGpqdXNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA2MDk0NCwiZXhwIjoyMDY2NjM2OTQ0fQ.KSTXkIETc0l-fbFG_SkuLMcIe1rf83vY3QnMRHYQxaw";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let groupChat = null; // Unused, group functionality is removed
let group = null; // Unused, group functionality is removed

// Укажи путь к chrome.exe, если он отличается (используй только прямые слэши для кроссплатформенности)
const chromePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(chromePath)) {
    console.error('[BROWSER LAUNCH] Файл браузера не найден по пути:', chromePath);
    process.exit(1);
}

console.log('[FULL LOG] Проверка sessionName:', process.argv[2]);
let sessionName = process.argv[2];
const telegramChatId = process.argv[3] || null;
console.log('[FULL LOG] telegramChatId:', telegramChatId);
let sessionRenamed = false;
let activationNotified = false;
let phoneNumber = null;
let isAuthenticated = false;

// Глобальный флаг сбоя для сессий
const failedFlagDir = path.join(__dirname, '.wwebjs_failed_sessions');
if (!fs.existsSync(failedFlagDir)) fs.mkdirSync(failedFlagDir, { recursive: true });
const failedFlagPath = path.join(failedFlagDir, `${sessionName}.failed`);
console.log('[FULL LOG] failedFlagPath:', failedFlagPath);
if (fs.existsSync(failedFlagPath)) {
    console.log('[SESSION] Сессия ранее была завершена с ошибкой/баном. Новый запуск не производится.');
    process.exit(0);
}

// В режиме сервера: слушаем команды на запуск сессии
if (!sessionName) {
    // Удаляем все старые сессии при запуске сервера
    const sessionsDir = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(sessionsDir)) {
        for (const d of fs.readdirSync(sessionsDir)) {
            const fullPath = path.join(sessionsDir, d);
            if (fs.lstatSync(fullPath).isDirectory()) {
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                    console.log('[CLEANUP] Удалена папка сессии:', fullPath);
                } catch (e) {
                    console.log('[CLEANUP] Ошибка удаления', fullPath, e.message);
                }
            }
        }
    }
    // --- Удаляем warming_up_numbers.txt только при запуске основного сервера ---
    // const warmingUpFile = path.join(__dirname, 'warming_up_numbers.txt');
    // if (fs.existsSync(warmingUpFile)) {
    //     try {
    //         fs.unlinkSync(warmingUpFile);
    //         console.log('[CLEANUP] warming_up_numbers.txt удалён при запуске');
    //     } catch (e) {
    //         console.log('[CLEANUP] Не удалось удалить warming_up_numbers.txt:', e.message);
    //     }
    // }

    // cleanDeadWarmingUpNumbers(); // <-- УДАЛЯЮ этот вызов отсюда, он должен быть только после объявления функций
    const server = http.createServer((req, res) => {
        console.log('[FULL LOG] HTTP-запрос:', req.method, req.url);
        if (req.method === 'POST' && req.url === '/start_session') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { sessionName, userId, phoneNumber } = JSON.parse(body);
                    console.log('[FULL LOG] /start_session params:', { sessionName, userId, phoneNumber });
                    if (sessionName && userId) {
                        // Абсолютный путь к index.js
                        const indexJsPath = path.join(__dirname, 'index.js');
                        // --- Удаляем флаг отмены для этого chatId перед запуском новой сессии ---
                        if (userId) {
                            const cancelFlag = path.join(__dirname, `cancelled_${userId}.flag`);
                            if (fs.existsSync(cancelFlag)) {
                                try { fs.unlinkSync(cancelFlag); } catch {}
                            }
                        }
                        // Запускаем отдельный процесс для новой сессии
                        const args = [indexJsPath, sessionName, userId];
                        if (phoneNumber) args.push(phoneNumber);
                        console.log('[FULL LOG] spawn node', args);
                        spawn('node', args, { stdio: 'inherit' });
                        res.writeHead(200);
                        res.end('OK');
                    } else {
                        res.writeHead(400);
                        res.end('Missing params');
                    }
                } catch (e) {
                    res.writeHead(400);
                    res.end('Bad request');
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });
    server.listen(3000, () => {
        console.log('Server listening on port 3000');
    });
    // --- Добавляем сервер отмены авторизации только в главном процессе ---
    const cancelApp = express();
    cancelApp.use(express.json());
    cancelApp.post('/cancel_auth', async (req, res) => {
        const { sessionName, phoneNumber, chatId } = req.body;
        try {
            if (chatId) {
                const cancelFlag = path.join(__dirname, `cancelled_${chatId}.flag`);
                fs.writeFileSync(cancelFlag, String(Date.now()), 'utf-8');
                console.log(`[CANCEL_AUTH] Флаг отмены создан: ${cancelFlag}`);
            }
            res.json({ status: 'ok' });
        } catch (e) {
            res.status(500).json({ status: 'error', detail: e.message });
        }
    });
    cancelApp.listen(3010, () => {
        console.log('Cancel auth server listening on port 3010');
    });
    return;
}

// Если не передан sessionName — не запускать клиента!
if (!sessionName) {
    console.log('index.js: Нет параметров — запуск клиента отменён.');
    process.exit(0);
}

// --- Создаём user.txt сразу при запуске, если есть telegramChatId ---
try {
    const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
        console.log('[FULL LOG] Создана папка сессии:', sessionDir);
    }
    if (telegramChatId && !fs.existsSync(path.join(sessionDir, 'user.txt'))) {
        fs.writeFileSync(path.join(sessionDir, 'user.txt'), String(telegramChatId), 'utf-8');
        console.log('[FULL LOG] Создан user.txt для telegramChatId:', telegramChatId);
    }
} catch (e) {
    console.log('[LOG] Не удалось создать user.txt при запуске:', e.message);
}

// Получаем phoneNumber из параметров запуска (если есть)
if (process.argv.length > 4) {
    phoneNumber = process.argv[4];
    console.log('[FULL LOG] phoneNumber из argv:', phoneNumber);
    // --- Нормализация номера ---
    let digits = String(phoneNumber).replace(/[^0-9]/g, '');
    if (digits.length > 11) digits = digits.slice(-11);
    if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
        digits = '7' + digits.slice(1);
        phoneNumber = '+'.concat(digits);
    } else {
        phoneNumber = null; // некорректный номер, не используем
    }
    // Сохраняем в файл для автоматизации
    try {
        const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log('[FULL LOG] Создана папка сессии (phoneNumber):', sessionDir);
        }
        if (phoneNumber) {
            fs.writeFileSync(path.join(sessionDir, 'phone.txt'), phoneNumber, 'utf-8');
            console.log('[FULL LOG] Сохранён phone.txt:', phoneNumber);
        }
    } catch (e) {
        console.log('[LOG] Не удалось сохранить phone.txt:', e.message);
    }
} else {
    // Пробуем прочитать из файла (если вдруг процесс перезапущен)
    try {
        const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
        const phonePath = path.join(sessionDir, 'phone.txt');
        if (fs.existsSync(phonePath)) {
            phoneNumber = fs.readFileSync(phonePath, 'utf-8').trim();
            console.log('[FULL LOG] phoneNumber из phone.txt:', phoneNumber);
        }
    } catch {}
}

// Инициализация клиента WhatsApp с локальным хранением сессии
// Browser initialization

// === Puppeteer Extra с плагином Stealth ===
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// --- Генерация User-Agent как в 1.py ---
function getRandomUserAgent() {
    const userAgents = [
        // Chrome (Windows, macOS, Linux)
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
        "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/112.0.0.0",
        "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OPR/113.0.0.0",
        // Brave (Windows, macOS, Linux)
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

const userAgent = getRandomUserAgent();
console.log('[FULL LOG] Используемый User-Agent:', userAgent);

const PROXY_TXT_PATH = path.join(__dirname, 'proxy.txt');
const EXTENSION_FOLDER = path.join(__dirname, 'proxy_auth_extension');
const BACKGROUND_JS_PATH = path.join(EXTENSION_FOLDER, 'background.js');

function getRandomProxy() {
    const proxies = fs.readFileSync(PROXY_TXT_PATH, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    if (!proxies.length) throw new Error('proxy.txt пуст или не найден!');
    return proxies[Math.floor(Math.random() * proxies.length)];
}

function updateProxyExtension(proxy) {
    // login:password@ip:port
    const [credentials, ipPort] = proxy.split('@');
    const [login, password] = credentials.split(':');
    const [ip, port] = ipPort.split(':');
    const backgroundJsContent = `\nvar config = {\n    mode: \"fixed_servers\",\n    rules: {\n        singleProxy: {\n            scheme: \"http\",\n            host: \"${ip}\",\n            port: parseInt(\"${port}\")\n        },\n        bypassList: [\"localhost\"]\n    }\n};\n\nchrome.proxy.settings.set({value: config, scope: \"regular\"}, function() {});\nchrome.webRequest.onAuthRequired.addListener(\n    function(details) {\n        return {\n            authCredentials: {\n                username: \"${login}\",\n                password: \"${password}\"\n            }\n        };\n    },\n    {urls: [\"<all_urls>\"]},\n    [\"blocking\"]\n);\n`;
    fs.writeFileSync(BACKGROUND_JS_PATH, backgroundJsContent, 'utf-8');
    console.log('[PROXY] background.js сгенерирован для прокси:', proxy);
}

// --- Выбор и установка прокси ---
// const selectedProxy = getRandomProxy();
// updateProxyExtension(selectedProxy);

const puppeteerArgs = [
    '--window-size=800,600',
    // ПРОКСИ-РАСШИРЕНИЯ ОТКЛЮЧЕНЫ:
    // '--disable-extensions-except=' + EXTENSION_FOLDER,
    // '--load-extension=' + EXTENSION_FOLDER,
    // остальные аргументы:
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-popup-blocking',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--metrics-recording-only',
    '--disable-prompt-on-repost',
    '--disable-notifications',
    '--disable-translate',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=0',
    '--disable-webgl',
    '--disable-accelerated-video-decode',
    '--disable-accelerated-video-encode',
    '--disable-accelerated-mjpeg-decode',
    '--disable-service-worker',
    '--disk-cache-size=0',
    '--media-cache-size=0',
    '--no-pings',
    '--disable-prefetch',
    '--disable-prerender-local-predictor',
    '--disable-zero-browsers-open-for-tests',
    '--disable-speech-api',
    '--disable-print-preview',
    '--renderer-process-limit=1',
    '--max-active-webgl-contexts=1',
    '--disable-webrtc',
    '--enable-logging=stderr',
    '--v=1',
    '--force-device-scale-factor=1',
    '--max-gum-fps=1',
    '--ignore-certificate-errors',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--user-agent=${userAgent}`,
    '--log-level=3',
    '--disable-logging'
];
console.log('[FULL LOG] puppeteer executablePath:', chromePath);
console.log('[FULL LOG] puppeteer args:', puppeteerArgs);

const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionName }),
    puppeteer: {
        executablePath: chromePath,
        headless: false,
        windowsHide: true,
        args: puppeteerArgs
    }
});
console.log('[FULL LOG] Клиент WhatsApp создан:', { sessionName, chromePath, telegramChatId });

// --- Установка user-agent через CDP максимально рано ---
client.on('browser_start', async () => {
    try {
        const page = client.pupPage || client._page || (client._client && client._client.page);
        if (page) {
            // Подмена fingerprint: platform и userAgent
            await page.evaluateOnNewDocument((userAgent) => {
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
                Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows)' });
                Object.defineProperty(navigator, 'oscpu', { get: () => 'Windows NT 10.0; Win64; x64' });
                if (navigator.userAgentData) {
                    try {
                        Object.defineProperty(navigator.userAgentData, 'platform', { get: () => 'Windows' });
                    } catch {}
                }
                Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            }, userAgent);
            await page.setRequestInterception(true);
            page.on('request', async (req) => {
                req.continue();
            });
        } else {
            console.log('[CDP] Не удалось получить Puppeteer Page для установки user-agent через CDP (browser_start)');
        }
    } catch (e) {
        console.log('[CDP] Ошибка установки user-agent через CDP (browser_start):', e.message);
    }
});

// --- fallback: если browser_start не сработал, повторяем в ready ---
client.on('ready', async () => {
    try {
        const page = client.pupPage || client._page || (client._client && client._client.page);
        if (page && page._client && typeof page._client.send === 'function') {
            await page._client.send('Network.setUserAgentOverride', { userAgent });
            console.log('[CDP] User-Agent установлен через CDP (ready):', userAgent);
        } else {
            console.log('[CDP] Не удалось получить Puppeteer Page для установки user-agent через CDP (ready)');
        }
    } catch (e) {
        console.log('[CDP] Ошибка установки user-agent через CDP (ready):', e.message);
    }
    // ... существующий код ...
});

// Универсальный fetch для Node.js 18+ и ниже
let fetch;
try {
    fetch = global.fetch || require('node-fetch');
} catch (e) {
    fetch = require('node-fetch');
}

// Функция для получения случайного числа в диапазоне
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Функция для получения случайного сообщения из категории
function getRandomFromCategory(category) {
    if (messageTemplates[category] && messageTemplates[category].length > 0) {
        const randomIndex = Math.floor(Math.random() * messageTemplates[category].length);
        return messageTemplates[category][randomIndex];
    }
    return null;
}

// Функция для получения случайного сообщения
function getRandomMessage() {
    const categories = Object.keys(messageTemplates);
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    return getRandomFromCategory(randomCategory);
}

// Функция для получения сообщения в зависимости от времени суток
function getTimeBasedMessage() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
        return getRandomFromCategory('motivational');
    } else if (hour >= 12 && hour < 17) {
        return getRandomFromCategory('business');
    } else if (hour >= 17 && hour < 22) {
        return getRandomFromCategory('thoughts');
    } else {
        return getRandomFromCategory('humor');
    }
}

// Функция для отправки сообщений с случайными задержками
async function sendRandomMessages(client, chatId) {
    while (true) {
        try {
            // Получаем сообщение в зависимости от времени суток
            const timeBasedMessage = getTimeBasedMessage();
            if (timeBasedMessage) {
                const chat = await client.getChatById(chatId);
                await simulateTyping(chat);
                await client.sendMessage(chatId, timeBasedMessage);
                console.log(`[LOG] Отправляю ТЕКСТ в ${chatId}: ${timeBasedMessage}`);
            }

            // Получаем случайное сообщение
            const randomMessage = getRandomMessage();
            if (randomMessage) {
                const chat = await client.getChatById(chatId);
                await simulateTyping(chat);
                await client.sendMessage(chatId, randomMessage);
                console.log(`[LOG] Отправляю ТЕКСТ в ${chatId}: ${randomMessage}`);
            }

            // Генерируем случайную задержку от 1 до 2 минут
            const delay = getRandomInt(60000, 120000);
            console.log(`[LOG] Следующее сообщение будет отправлено через ${Math.floor(delay/1000)} секунд`);
            
            // Ждем случайное время перед следующей отправкой
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            console.error('Ошибка при отправке сообщения:', error);
            // Ждем 5 секунд перед следующей попыткой в случае ошибки
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// --- Функция для отправки QR-кода в Python FastAPI ---
async function sendQrToPythonApi(qrBuffer, chatId, isBytes = false, sessionName = null) {
    try {
        // md5 hash для sessionName
        const sessionHash = crypto.createHash('md5').update(String(sessionName)).digest('hex');
        const cancelButton = {
            text: '❌ Отменить авторизацию',
            callback_data: `cancel_auth|${sessionHash}`
        };
        await axios.post('http://localhost:8000/send_qr', {
            chat_id: chatId,
            qr_data: isBytes ? qrBuffer.toString('base64') : qrBuffer.toString(),
            is_bytes: isBytes,
            session_name: sessionName,
            session_hash: sessionHash,
            reply_markup: {
                inline_keyboard: [[cancelButton]]
            }
        });
    } catch (e) {
        console.error('Ошибка отправки QR-кода в Python API:', e.message);
    }
}

// --- Генерация QR-кода для авторизации ---
client.on('qr', async (qr) => {
    if (phoneNumber) {
        // --- Если есть phoneNumber, запускаем автоматизацию входа по номеру ---
        const page = client.pupPage || client._page || (client._client && client._client.page);
        if (page) {
            lastSentTelegramCode = null; // Сброс перед новой попыткой авторизации
            await autoLoginByPhone(page, phoneNumber);
            await waitForAndSendCode(page, telegramChatId, sessionName, phoneNumber);
        } else {
            console.log('[LOGIN] Puppeteer Page не найден для автоматизации входа по номеру.');
        }
        // Не отправляем QR-код в Telegram!
        return;
    }
    // Если phoneNumber нет — отправляем QR-код в Telegram
    await sendQrToTelegramDirect(qr);
});

let isJoiningGroup = false;

client.on('authenticated', async () => {
    isAuthenticated = true;
    if (codeTimeout) {
        clearTimeout(codeTimeout);
        codeTimeout = null;
    }
    if (authStartTimeout) {
        clearTimeout(authStartTimeout);
        authStartTimeout = null;
    }
    console.log('Успешная авторизация!');

    // --- Автоматически закрываем приветственное окно, если оно появилось ---
    if (!isJoiningGroup) {
    try {
        const page = client.pupPage || client._page || (client._client && client._client.page);
        if (page) {
            // Ждём появления кнопки 'Продолжить' (до 5 секунд)
            const continueBtnSelector = 'button.x889kno.x1a8lsjc.x13jy36j.x64bnmy.x1n2onr6.x1rg5ohu.xk50ysn.x1f6kntn.xyesn5m.x1rl75mt.x19t5iym.xz7t8uv.x13xmedi.x178xt8z.x1lun4ml.xso031l.xpilrb4.x13fuv20.x18b5jzi.x1q0q8m5.x1t7ytsu.x1v8p93f.x1o3jo1z.x16stqrj.xv5lvn5.x1hl8ikr.xfagghw.x9dyr19.x9lcvmn.x1pse0pq.xcjl5na.xfn3atn.x1k3x3db.x9qntcr.xuxw1ft.xv52azi';
            try {
                await page.waitForSelector(continueBtnSelector, { timeout: 5000 });
                const btn = await page.$(continueBtnSelector);
                if (btn) {
                    await btn.click();
                    console.log('[DEBUG] Клик по кнопке "Продолжить" (приветственное окно WhatsApp Web) выполнен.');
                }
            } catch (e) {
                // Кнопка не найдена — окно не появилось, ничего страшного
            }
        }
    } catch (e) {
        console.log('[DEBUG] Ошибка при попытке закрыть приветственное окно WhatsApp Web:', e.message);
        }
    }
});

// Варианты статусов и имён
const STATUS_VARIANTS = [
    'Доступен',
    'Занят',
    'На связи',
    'Работаю',
    'В отпуске',
    'Встреча',
    'Пишите в личку',
    'Скоро вернусь',
    'Важные дела',
    'Всем хорошего дня!'
];
const NAME_VARIANTS = [
    'Артём',
    'Вася',
    'Иван',
    'Алексей',
    'Дмитрий',
    'Сергей',
    'Пользователь',
    'Чат-бот',
    'Гость',
    'Собеседник'
];

// Функция для смены статуса один раз
async function setRandomStatus(client) {
    const status = getRandom(STATUS_VARIANTS);
    try {
        await client.setStatus(status);
        console.log('Статус изменён на:', status);
    } catch (e) {
        console.log('Ошибка смены статуса:', e.message);
    }
}

// Функция для смены имени один раз
async function setRandomName(client) {
    const name = getRandom(NAME_VARIANTS);
    try {
        await client.setDisplayName(name);
        console.log('Имя изменено на:', name);
    } catch (e) {
        console.log('Ошибка смены имени:', e.message);
    }
}

// --- Новый массив actionTypes с весами ---
const WEIGHTED_ACTION_TYPES = [
    'text','text','text','text','text', // 5x чаще текст
    'voice','voice','voice',            // 3x чаще голосовое
    'forward_sticker',                  // 1x стикер
    'forward_gif'                       // 1x gif
];

function getWeightedRandomActionType(lastType) {
    // Исключаем предыдущий тип, если нужно
    const filtered = lastType ? WEIGHTED_ACTION_TYPES.filter(t => t !== lastType) : WEIGHTED_ACTION_TYPES;
    return getRandom(filtered);
}

// --- stableRandomMessageLoop ---
// This function is no longer used and has been removed.


// --- sendHumanLikeMessages ---
// This function is no longer used and has been removed.

// --- startAutoWarmup ---
async function startAutoWarmup(client) {
    console.log('[WARMUP] 6-часовая сессия запущена. Прогрев начинается сразу.');

    const WARMUP_HOURS = 6;
    const endTime = Date.now() + WARMUP_HOURS * 60 * 60 * 1000;

    // Сохраняем время окончания сессии в файл, чтобы Telegram-бот мог его прочитать
    try {
        const wid = client.info.wid._serialized;
        const sessionDir = path.join(__dirname, `.wwebjs_auth/session_${wid}`);
        if (fs.existsSync(sessionDir)) {
            fs.writeFileSync(path.join(sessionDir, 'warmup_end.txt'), String(Math.floor(endTime / 1000)), 'utf-8');
            console.log(`[WARMUP] Время окончания сессии сохранено в ${path.join(sessionDir, 'warmup_end.txt')}`);
        }
    } catch (e) {
        console.log('[WARMUP] Не удалось сохранить warmup_end.txt:', e.message);
    }

    // УБРАНО: ожидание 30 минут
    // await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
    // console.log('[WARMUP] 30-минутный период ожидания завершен, начинаю прогрев.');

    if (!client.info) {
        console.log('[WARMUP] client.info еще не готов, ожидание 5 секунд...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (!client.info) {
            console.error('[WARMUP] КРИТИЧЕСКАЯ ОШИБКА: client.info все еще не доступен. Прогрев отменен.');
            return;
        }
    }

    const myId = client.info.wid._serialized;
    let lastUserId = null;

    // Получаем участников прогрева из Supabase (accounts с status 'active', кроме себя)
    async function getActiveParticipants() {
        const { data, error } = await supabase
            .from('accounts')
            .select('account_number')
            .eq('status', 'active');
        if (error) {
            console.log('[SUPABASE] Ошибка получения участников прогрева:', error.message);
            return [];
        }
        return (data || []).map(acc => acc.account_number).filter(id => id !== myId);
    }

    while (Date.now() < endTime) {
        let currentParticipants = await getActiveParticipants();
        if (currentParticipants.length === 0) {
            console.log('[WARMUP] Нет других участников для общения в ЛС. Ожидание...');
            await new Promise(res => setTimeout(res, 5 * 60 * 1000));
            continue;
        }
        let potentialTargets = currentParticipants;
        if (lastUserId && currentParticipants.length > 1) {
            potentialTargets = currentParticipants.filter(id => id !== lastUserId);
        }
        const userId = getRandom(potentialTargets);
        const msgsForUser = 3;
        console.log(`[WARMUP] Начало сессии общения со случайным пользователем ${userId}. Сообщений: ${msgsForUser}`);
        for (let i = 0; i < msgsForUser && Date.now() < endTime; i++) {
            try {
                const chat = await client.getChatById(userId);
                const type = getWeightedRandomActionType();
                let sentMsg = null;
                if (type === 'text') {
                    const content = await getRandomTextWithApi();
                    await simulateTyping(chat);
                    sentMsg = await client.sendMessage(userId, content);
                    console.log(`[LOG] WARMUP: Отправлен ТЕКСТ в ${userId}: ${content}`);
                } else if (type === 'voice') {
                    await sendGeneratedVoice(client, userId);
                    console.log(`[LOG] WARMUP: Отправлено ГОЛОСОВОЕ в ${userId}`);
                } else if (type === 'forward_sticker') {
                    await forwardRandomMediaFromChat(client, chat, MediaType.STICKER);
                    console.log(`[LOG] WARMUP: Отправлен СТИКЕР в ${userId}`);
                } else if (type === 'forward_gif') {
                    await forwardRandomMediaFromChat(client, chat, MediaType.GIF);
                    console.log(`[LOG] WARMUP: Отправлен GIF в ${userId}`);
                }
                if (sentMsg && Math.random() < 0.07) {
                    await sentMsg.react(getRandom(REACTIONS));
                }
            } catch (e) {
                console.log(`[WARMUP] Ошибка при отправке сообщения в ЛС ${userId}:`, e.message);
            }
            await new Promise(res => setTimeout(res, getRandomDelay()));
        }
        lastUserId = userId;
    }
    const now = Date.now();
    const remainingTime = endTime - now;
    if (remainingTime > 0) {
        console.log(`[WARMUP] Основная фаза завершена, жду оставшееся время: ${Math.floor(remainingTime / 1000)} сек.`);
        await new Promise(res => setTimeout(res, remainingTime));
    }
    console.log('[WARMUP] Время прогрева истекло, запускаю процедуру завершения.');
    try {
        console.log('[WARMUP] Завершаю клиент WhatsApp...');
        await client.destroy();
        console.log('[WARMUP] Клиент WhatsApp завершен.');
        const sessionPath = path.join(__dirname, `.wwebjs_auth/session_${myId}`);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('[WARMUP] Сессия удалена:', sessionPath);
        }
        // --- Удаляем аккаунт из Supabase ---
        await markAccountFinished(myId);
    } catch (e) {
        console.log('[WARMUP] Ошибка при удалении своей сессии:', e.message);
    }
    try {
        const cleanNumber = myId.replace(/@.*/, '');
        await notifyTelegramError(`Прогрев с номером ${cleanNumber} завершился`);
    } catch (e) {
        console.log('[WARMUP] Ошибка при отправке уведомления в Telegram:', e.message);
    }
    process.exit(0);
}

// Тематические шаблоны сообщений только о работе центральной больницы (ЦРБ)
const THEMES = {
    crb: [
        'Коллеги, кто сегодня дежурит на приёме?',
        'Принесите, пожалуйста, пинцет в перевязочную 🙏',
        'Кто последний занимал процедурный кабинет?',
        'У кого есть свободный тонометр? Мой опять разрядился 😅',
        'Срочно нужна помощь в 12 палате!',
        'Кто-нибудь видел мои очки? Оставлял на посту…',
        'Пациент Иванов спрашивает, когда будет рентген?',
        'Кто идёт на обед — возьмите чайник, пожалуйста!',
        'В регистратуре закончились бланки, кто может принести?',
        'Кто сегодня отвечает за выписку?',
        'Коллеги, не забудьте заполнить журнал температур!',
        'Кто может подменить на приёме с 15:00?',
        'В ординаторской закончился кофе, кто закажет?',
        'Кто-нибудь идёт в аптеку? Возьмите бинты!',
        'Пациентка Петрова ждёт консультацию хирурга.',
        'Кто сегодня на вызовах?',
        'В процедурной нет спирта, кто может принести?',
        'Кто-нибудь видел новые перчатки? Где лежат?',
        'Коллеги, не забудьте про планёрку в 14:00!',
        'Кто может помочь с транспортировкой пациента?',
        'В ординаторской сломался чайник, кто чинит?',
        'Кто-нибудь идёт в столовую? Возьмите салфетки!',
        'Кто сегодня закрывает смену?',
        'В приёмном покое много пациентов, нужна помощь!',
        'Кто-нибудь знает, где лежит запасной термометр?',
        'Коллеги, не забудьте подписать обходной лист!',
        'Кто может заменить на завтра?',
        'В ординаторской закончились ручки, кто купит?',
        'Кто-нибудь идёт в магазин? Возьмите воду!',
        'Пациент жалуется на боль, кто свободен?',
        'Кто-нибудь видел ключи от процедурной?',
        'В ординаторской закончились салфетки, кто возьмёт?',
        'Коллеги, кто возьмёт смену в воскресенье?',
        'В процедурной нет бинтов, кто может принести?',
        'Кто-нибудь идёт на склад? Возьмите перчатки!',
        'Пациент Петров не пришёл на приём, кто звонил?',
        'Кто может помочь с заполнением отчёта?',
        'В ординаторской нет бумаги для принтера, кто купит?',
        'Коллеги, кто идёт на планёрку?',
        'Кто-нибудь видел новые бахилы?',
        'В процедурной закончились шприцы, кто возьмёт?',
        'Кто может подменить на обходе?',
        'Пациентка Сидорова ждёт анализы, кто в курсе?',
        'Кто-нибудь идёт в буфет? Возьмите чай!',
        'В ординаторской нет мыла, кто купит?',
        'Коллеги, кто сегодня на приёме после обеда?',
        'Кто может помочь с оформлением выписки?',
        'В процедурной нет ваты, кто возьмёт?',
        'Кто-нибудь идёт на склад? Возьмите маски!',
        'Пациент жалуется на температуру, кто посмотрит?',
        'Кто может подменить на регистратуре?',
        'В ординаторской закончился сахар, кто купит?',
        'Коллеги, не забудьте про собрание в 16:00!',
        'Кто-нибудь видел новые халаты?',
        'В процедурной нет йода, кто возьмёт?',
        'Кто может помочь с транспортировкой анализов?',
        'Пациентка Иванова ждёт перевязку, кто свободен?',
        'Кто-нибудь идёт в аптеку? Возьмите шприцы!',
        'В ординаторской нет воды, кто купит?',
        'Коллеги, кто сегодня на ночном дежурстве?',
        'Кто может подменить на приёме утром?',
        'В процедурной закончились перчатки, кто возьмёт?',
        'Кто-нибудь идёт в магазин? Возьмите печенье!',
        'Пациент жалуется на головную боль, кто посмотрит?',
        'Кто может помочь с оформлением направления?',
        'В ординаторской нет салфеток, кто купит?',
        'Коллеги, не забудьте про отчёт до конца дня!',
        'Кто-нибудь видел новые маски?',
        'В процедурной нет бинтов, кто возьмёт?',
        'Кто может подменить на обходе вечером?',
        'Пациентка Сидорова ждёт врача, кто свободен?',
        'Кто-нибудь идёт в буфет? Возьмите чай!',
        'В ординаторской нет мыла, кто купит?',
        // ... остальные ваши сообщения ...
    ]
};

// Реакции (эмодзи)
const REACTIONS = ['👍','😂','🔥','😍','😱','👏','😎','🥳','🤔','😅','❤️','😆'];

// Настройки задержек (в миллисекундах)
const DELAY_BETWEEN_ACTIONS = { min: 60000, max: 120000 }; // 1-2 мин

function getRandomDelay() {
    return getRandomInt(DELAY_BETWEEN_ACTIONS.min, DELAY_BETWEEN_ACTIONS.max);
}

// Имитация набора текста
async function simulateTyping(chat) {
    await chat.sendStateTyping();
    await new Promise(res => setTimeout(res, getRandomInt(2000, 7000)));
    await chat.clearState();
}

// --- Умные реакции на входящие сообщения ---
// This is no longer used
// const SMART_REPLIES = [
//     { keywords: ['привет', 'здравствуй', 'hello', 'hi'], type: 'sticker' },
//     { keywords: ['спасибо', 'thanks', 'thank you'], type: 'gif' },
//     { keywords: ['как дела', 'how are you'], type: 'text', text: 'Всё отлично! А у тебя?' },
//     { keywords: ['пока', 'bye', 'до свидания'], type: 'sticker' },
// ];

client.on('message', async (msg) => {
    try {
        const chat = await msg.getChat();
        if (msg.fromMe) return; // не реагируем на свои
        // --- Реакции только в личках из прогрева ---
        let isTargetPrivate = !chat.isGroup && WARMUP_PARTICIPANTS.includes(chat.id._serialized);
        
        // --- Автоответ с вероятностью 0.5% в выбранных номерах ---
        if (isTargetPrivate && msg.body && typeof msg.body === 'string' && Math.random() < 0.005) {
            if (msg.hasQuotedMsg) return; // Не отправляем автоответ на reply-сообщения
            if (!msg.body.startsWith('/') && msg.body.length > 3) {
                const replyText = getRandom(THEMES.crb);
                const delay = getRandomDelay(); // задержка как у обычных сообщений
                setTimeout(async () => {
                    await simulateTyping(chat);
                    await msg.reply(replyText);
                    await client.sendMessage(chat.id._serialized, replyText);
                }, delay);
            }
        }
    } catch (e) {
        console.log('[LOG] Ошибка в SMART-реакции:', e.message);
    }
});

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Добавляю новые типы медиа для пересылки
const MediaType = { STICKER: 'sticker', GIF: 'gif', IMAGE: 'image' };

const STICKERS_DIR = path.join(__dirname, 'stickers');
const PHOTOS_DIR = path.join(__dirname, 'photos');
const GIFS_DIR = path.join(__dirname, 'gifs');

// Обновляю функцию пересылки медиа
async function forwardRandomMediaFromChat(client, chat, type) {
    if (type === MediaType.IMAGE) {
        console.log('[DEBUG] Попытка отправить фото...');
        if (fs.existsSync(PHOTOS_DIR)) {
            const files = fs.readdirSync(PHOTOS_DIR).filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
            console.log('[DEBUG] Найдено файлов фото:', files);
            if (files.length > 0) {
                const randomPhoto = getRandom(files);
                const photoPath = path.join(PHOTOS_DIR, randomPhoto);
                try {
                    const photoBuffer = fs.readFileSync(photoPath);
                    let mime = 'image/jpeg';
                    if (randomPhoto.endsWith('.png')) mime = 'image/png';
                    if (randomPhoto.endsWith('.webp')) mime = 'image/webp';
                    console.log('[DEBUG][PHOTO] Файл:', photoPath, 'Размер:', photoBuffer.length, 'байт', 'Mime:', mime);
                    const media = new MessageMedia(mime, photoBuffer.toString('base64'), randomPhoto);
                    let sentMsg = null;
                    try {
                        sentMsg = await chat.sendMessage(media);
                        console.log('[DEBUG][PHOTO] sendMessage результат:', sentMsg);
                    } catch (sendErr) {
                        console.log('[DEBUG][PHOTO] Ошибка при отправке фото:', sendErr.message, sendErr.stack);
                        throw sendErr;
                    }
                    if (sentMsg && sentMsg.id) {
                        console.log(`[LOG] Фото успешно отправлено из папки: ${randomPhoto}`);
                        return true;
                    } else {
                        console.log('[DEBUG][PHOTO] sendMessage не вернул id');
                    }
                } catch (e) {
                    console.log(`[DEBUG][PHOTO] Ошибка при отправке фото ${randomPhoto}:`, e.message, e.stack);
                }
            } else {
                console.log('[DEBUG][PHOTO] Нет файлов фото в папке photos');
            }
        } else {
            console.log('[DEBUG][PHOTO] Папка photos не найдена');
        }
        return false;
    } else if (type === MediaType.GIF) {
        if (fs.existsSync(GIFS_DIR)) {
            const files = fs.readdirSync(GIFS_DIR).filter(f => f.match(/\.gif$/i));
            if (files.length > 0) {
                const randomGif = getRandom(files);
                const gifPath = path.join(GIFS_DIR, randomGif);
                const gifBuffer = fs.readFileSync(gifPath);
                try {
                    await new Promise(res => setTimeout(res, 5000));
                    const tmpMp4 = path.join(os.tmpdir(), `gif_${Date.now()}.mp4`);
                    try {
                        execFileSync('ffmpeg', [
                            '-y',
                            '-i', gifPath,
                            '-movflags', 'faststart',
                            '-pix_fmt', 'yuv420p',
                            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                            tmpMp4
                        ], { stdio: 'ignore' });
                        const mp4Buffer = fs.readFileSync(tmpMp4);
                        const media = new MessageMedia('video/mp4', mp4Buffer.toString('base64'), randomGif.replace(/\.gif$/i, '.mp4'));
                        const sentMsg = await chat.sendMessage(media, { sendVideoAsGif: true });
                        if (sentMsg && sentMsg.id) {
                            return true;
                        }
                    } catch (e) {
                    } finally {
                        if (fs.existsSync(tmpMp4)) fs.unlinkSync(tmpMp4);
                    }
                    try {
                        const media = new MessageMedia('image/gif', gifBuffer.toString('base64'), randomGif);
                        const sentMsg = await chat.sendMessage(media);
                        if (sentMsg && sentMsg.id) {
                            return true;
                        }
                    } catch (e) {
                    }
                } catch (e) {
                }
            } else {
            }
        } else {
        }
        return false;
    } else if (type === MediaType.STICKER) {
        if (fs.existsSync(STICKERS_DIR)) {
            const files = fs.readdirSync(STICKERS_DIR).filter(f => f.match(/\.webp$/i));
            if (files.length > 0) {
                const randomSticker = getRandom(files);
                const stickerPath = path.join(STICKERS_DIR, randomSticker);
                const stickerBuffer = fs.readFileSync(stickerPath);
                try {
                    const media = new MessageMedia('image/webp', stickerBuffer.toString('base64'), randomSticker);
                    const sentMsg = await chat.sendMessage(media, { sendMediaAsSticker: true });
                    if (sentMsg && sentMsg.id) {
                        return true;
                    }
                } catch (e) {
                }
            } else {
            }
        } else {
        }
        return false;
    } else {
        console.log(`[LOG] Отправка типа ${type} не поддерживается (только фото из папки, gif/стикер — пересылка и из папки)`);
    }
    return false;
}

// Получить случайный GIF с Tenor
async function fetchRandomGifUrl() {
    try {
        const apiKey = 'LIVDSRZULELA'; // public demo key Tenor
        const res = await fetch(`https://tenor.googleapis.com/v2/random?q=funny&key=${apiKey}&limit=1&media_filter=gif`);
        const data = await res.json();
        if (data && data.results && data.results.length > 0) {
            // Берём первый gif
            const gifObj = data.results[0];
            if (gifObj.media_formats && gifObj.media_formats.gif && gifObj.media_formats.gif.url) {
                return gifObj.media_formats.gif.url;
            }
        }
    } catch (e) {
        console.log('Ошибка получения GIF с Tenor:', e.message);
    }
    return null;
}

// Скачать файл по URL и вернуть Buffer
async function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
    });
}

// Имитация набора текста и стирания
async function maybeSimulateTyping(client, chatId) {
    // 20% шанс просто "почитать" (ничего не писать)
    if (Math.random() < 0.2) {
        // имитация чтения (ничего не делаем, просто пауза)
        const readPause = getRandomInt(10000, 30000);
        await new Promise(res => setTimeout(res, readPause));
        return false;
    }
    // 20% шанс имитировать набор и стирание
    if (Math.random() < 0.2) {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        await new Promise(res => setTimeout(res, getRandomInt(2000, 6000)));
        await chat.clearState();
        // ничего не отправляем
        return false;
    }
    // 20% шанс имитировать набор, потом отправить
    if (Math.random() < 0.2) {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        await new Promise(res => setTimeout(res, getRandomInt(2000, 6000)));
        await chat.clearState();
        return true;
    }
    // В остальных случаях — сразу отправлять
    return true;
}

const WORKING_VOICE_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.ogg';

// Генерация простого WAV-файла с разными типами звуков
function generateWavBuffer(type = 'beep', durationSec = 1, options = {}) {
    const sampleRate = 16000;
    let length = Math.floor(sampleRate * durationSec);
    let channelData = new Float32Array(length);
    let volume = options.volume !== undefined ? options.volume : 1.0;
    let tempo = options.tempo !== undefined ? options.tempo : 1.0;
    // Темп: если tempo != 1, меняем длину
    if (tempo !== 1.0) {
        length = Math.floor(length / tempo);
        channelData = new Float32Array(length);
    }
    if (type === 'beep') {
        const freq = 880 + Math.random() * 400;
        for (let i = 0; i < length; i++) {
            channelData[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate) * tempo) * 0.3 * volume;
        }
    } else if (type === 'doublebeep') {
        const freq = 1000 + Math.random() * 300;
        for (let i = 0; i < length; i++) {
            if ((i < length * 0.2) || (i > length * 0.4 && i < length * 0.6)) {
                channelData[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate) * tempo) * 0.3 * volume;
            } else {
                channelData[i] = 0;
            }
        }
    } else if (type === 'melody') {
        const notes = [523.25, 659.25, 783.99];
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate * tempo;
            let noteIdx = 0;
            if (t > durationSec / 3 && t <= 2 * durationSec / 3) noteIdx = 1;
            if (t > 2 * durationSec / 3) noteIdx = 2;
            channelData[i] = Math.sin(2 * Math.PI * notes[noteIdx] * t) * 0.25 * volume;
        }
    } else if (type === 'melody2') {
        const notes = [392.00, 523.25, 659.25, 880.00];
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate * tempo;
            let noteIdx = Math.floor((t / durationSec) * notes.length) % notes.length;
            channelData[i] = Math.sin(2 * Math.PI * notes[noteIdx] * t) * 0.18 * volume;
        }
    } else if (type === 'chirp') {
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate * tempo;
            const freq = 400 + 2000 * t / durationSec;
            channelData[i] = Math.sin(2 * Math.PI * freq * t) * 0.15 * volume;
        }
    } else if (type === 'noise') {
        for (let i = 0; i < length; i++) {
            channelData[i] = (Math.random() * 2 - 1) * 0.2 * volume;
        }
    } else if (type === 'pause') {
        for (let i = 0; i < length; i++) channelData[i] = 0;
    } else if (type === 'breath') {
        // Имитация дыхания: низкочастотный шум
        for (let i = 0; i < length; i++) {
            channelData[i] = (Math.random() * 0.1 + Math.sin(2 * Math.PI * 120 * (i / sampleRate))) * 0.15 * volume;
        }
    } else if (type === 'mmm') {
        // Имитация "ммм": синусоидальный звук
        const freq = 180 + Math.random() * 40;
        for (let i = 0; i < length; i++) {
            channelData[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate)) * 0.12 * volume;
        }
    } else if (type === 'click') {
        // Щелчок микрофона
        for (let i = 0; i < length; i++) {
            channelData[i] = (i < 30) ? (Math.random() * 2 - 1) * 0.7 * volume : 0;
        }
    }
    // Фоновый шум (если указан)
    if (options.backgroundNoise) {
        for (let i = 0; i < length; i++) {
            channelData[i] += (Math.random() * 2 - 1) * 0.04 * options.backgroundNoise;
        }
    }
    return channelData;
}

// Генерация и отправка максимально "человеческого" голосового
async function sendGeneratedVoice(client, groupId) {
    const allTypes = ['beep', 'doublebeep', 'melody', 'melody2', 'noise', 'chirp', 'pause', 'breath', 'mmm', 'click'];
    const numFragments = getRandomInt(3, 7);
    let fragments = [];
    let totalLength = 0;
    for (let i = 0; i < numFragments; i++) {
        let type = getRandom(allTypes);
        if (Math.random() < 0.18) type = 'pause';
        if (Math.random() < 0.12) type = 'breath';
        if (Math.random() < 0.10) type = 'mmm';
        if (Math.random() < 0.07) type = 'click';
        const fragLen = Math.random() < 0.2 ? getRandomInt(1, 2) : getRandomInt(1, 4) + Math.random();
        const volume = 0.7 + Math.random() * 0.6;
        const tempo = 0.85 + Math.random() * 0.4;
        const backgroundNoise = Math.random() < 0.6 ? Math.random() * 0.7 : 0;
        fragments.push(generateWavBuffer(type, fragLen, { volume, tempo, backgroundNoise }));
        totalLength += Math.floor(16000 * fragLen / tempo);
        if (Math.random() < 0.3) {
            const pauseLen = 0.2 + Math.random() * 0.7;
            fragments.push(generateWavBuffer('pause', pauseLen));
            totalLength += Math.floor(16000 * pauseLen);
        }
    }
    let fullBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const frag of fragments) {
        fullBuffer.set(frag, offset);
        offset += frag.length;
    }
    const wavBuffer = wav.encode([fullBuffer], { sampleRate: 16000, float: true, bitDepth: 32 });
    const tmpWav = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
    const tmpOgg = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
    fs.writeFileSync(tmpWav, wavBuffer);
    try {
        execFileSync('ffmpeg', [
            '-y',
            '-i', tmpWav,
            '-c:a', 'libopus',
            '-ar', '16000',
            '-ac', '1',
            '-b:a', '24k',
            tmpOgg
        ], { stdio: 'ignore' });
        const base64 = fs.readFileSync(tmpOgg).toString('base64');
        const media = new MessageMedia('audio/ogg; codecs=opus', base64, 'voice.ogg');
        await new Promise(res => setTimeout(res, 3000));
        try {
            const chat = await client.getChatById(groupId);
            await simulateTyping(chat);
            await client.sendMessage(groupId, media, { sendAudioAsVoice: true });
        } catch (e) {
            console.log('Ошибка конвертации или отправки голосового:', e.message);
        }
    } catch (e) {
        console.log('Ошибка конвертации или отправки голосового:', e.message);
    } finally {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
        if (fs.existsSync(tmpOgg)) fs.unlinkSync(tmpOgg);
    }
}

// Получение случайного анекдота из jokeapi.dev
async function fetchJoke() {
    try {
        const res = await fetch('https://v2.jokeapi.dev/joke/Any?lang=ru&type=single');
        const data = await res.json();
        if (data && data.joke) return data.joke;
    } catch {}
    return null;
}

// Получение случайной цитаты из quotable.io
async function fetchQuote() {
    try {
        const res = await fetch('https://api.quotable.io/random?lang=ru');
        const data = await res.json();
        if (data && data.content) return `«${data.content}»`;
    } catch {}
    return null;
}

// Получение случайного мема (ссылка на картинку)
async function fetchMeme() {
    try {
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        if (data && data.url) return data.url;
    } catch {}
    return null;
}

async function getRandomTextWithApi() {
    // 14% шанс взять из API (анекдот или цитата), иначе — из локальных шаблонов
    const roll = Math.random();
    if (roll < 0.07) {
        const joke = await fetchJoke();
        if (joke) return joke;
    }
    if (roll < 0.14) {
        const quote = await fetchQuote();
        if (quote) return quote;
    }
    // иначе — локальный шаблон
    const themeKeys = Object.keys(THEMES);
    let msg = getRandom(THEMES[getRandom(themeKeys)]);
    if (Math.random() < 0.5) msg += ' ' + getRandom(REACTIONS);
    return msg;
}





client.on('auth_failure', () => {
    console.error('Ошибка авторизации. Попробуйте снова.');
});

client.on('disconnected', (reason) => {
    console.log('Клиент отключён:', reason);
});

// ... существующий код ...
// Удаляю или комментирую блок:
// console.log('Puppeteer config:', { ... });
// ... существующий код ...

// После создания клиента, но до client.initialize()
(async () => {
    try {
        client.initialize();
        setInterval(checkCancelFlagAndExit, 2000);
    } catch (e) {
        console.log('Ошибка при инициализации клиента WhatsApp:', e);
        logErrorToFile('Ошибка при инициализации клиента WhatsApp: ' + (e && e.stack ? e.stack : e));
    }
})();
// ... существующий код ...

// TODO: добавить рассылку сообщений в группу и интеграцию context7

const TELEGRAM_TOKEN = '8151467364:AAHavK2OpIuO2ZQt8crnoupXAYLFDfspNc0';

async function sendQrToTelegramDirect(qr) {
    if (!telegramChatId) return;
    // Генерируем PNG через qrcode
    const QRCode = require('qrcode');
    const qrImage = await QRCode.toBuffer(qr, { type: 'png' });
    // Отправляем через Telegram Bot API
    const formData = new FormData();
    formData.append('chat_id', telegramChatId);
    formData.append('caption', 'Сканируйте этот QR-код в WhatsApp!');
    formData.append('photo', qrImage, { filename: 'qr.png', contentType: 'image/png' });
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
        method: 'POST',
        body: formData
    });
}

// --- Логирование ошибок в отдельный файл ---
// Удалено: const ERROR_LOG_FILE = 'error.log';
// Удалено: функция logErrorToFile

// --- Уведомление о критических ошибках в Telegram (глобально) ---
async function notifyTelegramError(message) {
    if (!telegramChatId) return;
    try {
        await axios.post('http://localhost:8000/send_error', {
            chat_id: telegramChatId,
            error_text: message
        });
            } catch (e) {
        console.log('[ERROR] Не удалось отправить ошибку в Telegram:', e.message);
    }
}

// --- Автоматический рестарт клиента ---
function restartClient(reason) {
    const msg = `Клиент будет перезапущен. Причина: ${reason}`;
    console.log('[CRITICAL]', msg);
    logErrorToFile(msg);
    notifyTelegramError(msg);
    process.exit(1); // pm2 или nodemon перезапустит процесс
}

async function notifyAndCleanupSession(reasonText) {
    console.log('[DEBUG] Вызван notifyAndCleanupSession с причиной:', reasonText);
    let number = 'неизвестно';
    try {
        const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
        const numberPath = path.join(sessionDir, 'number.txt');
        if (fs.existsSync(numberPath)) {
            number = fs.readFileSync(numberPath, 'utf-8').trim();
            // НЕ обрезаем @c.us!
        }
    } catch (e) {
        console.log('[DEBUG] Ошибка при чтении number.txt:', e.message);
    }

    if (!reasonText.includes('Время на вход по QR-коду истекло')) {
        const cleanNumber = number.replace(/@.*/, '');
        console.log('[DEBUG] Попытка отправить уведомление в Telegram:', cleanNumber, reasonText, telegramChatId);
        try {
            await notifyTelegramError(`❗️ Сессия с номером <b>${cleanNumber}</b> слетела. Возможно, бан. Проверьте аккаунт!`);
            console.log('[DEBUG] Уведомление отправлено!');
    } catch (e) {
            console.error('[ERROR] Не удалось отправить уведомление в Telegram:', e);
        }
        await new Promise(res => setTimeout(res, 2000)); // пауза 2 сек
    }
    try {
        // Удаляем именно по номеру (wid), чтобы не было ошибки с sessionName
        const sessionDir = path.join(__dirname, `.wwebjs_auth/${number}`);
        writeSessionStatus(sessionDir, 'inactive');
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log('[CLEANUP] Папка сессии удалена:', sessionDir);
        } else {
            console.log('[DEBUG] Папка сессии не найдена для удаления:', sessionDir);
        }
        // --- Удаляем аккаунт из Supabase ---
        if (myId) await markAccountInactive(myId);
    } catch (e) {
        console.log('[CLEANUP] Ошибка удаления папки сессии:', e.message);
    }
    process.exit(1);
}

client.on('disconnected', (reason) => {
    logErrorToFile(`Клиент отключён: ${reason}`);
    notifyAndCleanupSession(reason);
});

client.on('auth_failure', (msg) => {
    logErrorToFile(`Ошибка авторизации: ${msg}`);
    notifyAndCleanupSession(msg);
});

process.on('uncaughtException', (err) => {
    console.log('UncaughtException:', err && err.stack ? err.stack : err);
    // logErrorToFile('UncaughtException: ' + (err && err.stack ? err.stack : err)); // Удалено
});

process.on('unhandledRejection', (reason) => {
    let msg;
    let isSocketError = false;
    let isTimeoutError = false;
    let isJsHandleError = false;
    if (reason instanceof Error) {
        msg = `UnhandledRejection: ${reason.stack || reason.message}`;
        if (reason.message && reason.message.includes('net::ERR_SOCKET_NOT_CONNECTED')) {
            isSocketError = true;
        }
        if (reason.message && reason.message.includes('net::ERR_CONNECTION_TIMED_OUT')) {
            isTimeoutError = true;
        }
        if (reason.message && reason.message.includes('JSHandles can be evaluated only in the context they were created!')) {
            isJsHandleError = true;
        }
    } else if (typeof reason === 'object') {
        try {
            msg = `UnhandledRejection: ${JSON.stringify(reason, null, 2)}`;
        } catch (e) {
            msg = `UnhandledRejection: [object with circular refs]`;
        }
    } else {
        msg = `UnhandledRejection: ${reason}`;
    }
    if (isSocketError || isTimeoutError || isJsHandleError) {
        // Полностью игнорируем ошибку, не логируем вообще и не перезапускаем клиента
        return;
    }
    console.log(msg);
    logErrorToFile(msg);
    notifyTelegramError(msg);
    restartClient('unhandledRejection');
});

process.on('SIGTERM', () => {
    console.log('[NODE] Получен SIGTERM, завершаю работу...');
    process.exit(0);
}); 
client.on('ready', async () => {
    if (activationNotified) return;
    activationNotified = true;
    // --- Блокировка действий при отмене авторизации ---
    if (telegramChatId) {
        const cancelFlag = path.join(__dirname, `cancelled_${telegramChatId}.flag`);
        if (fs.existsSync(cancelFlag)) {
            console.log('[READY] Обнаружен флаг отмены авторизации, полностью выхожу из обработчика ready. Никаких лимитов и действий!');
            try { fs.unlinkSync(cancelFlag); } catch {}
            return;
        }
    }
    console.log('Клиент WhatsApp готов!');
    try {
        const wid = client.info.wid._serialized;
        // Если sessionName ещё не совпадает с wid, переименовываем папку
        if (sessionName !== wid && !sessionRenamed) {
            const oldDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
            const newDir = path.join(__dirname, `.wwebjs_auth/session_${wid}`);
            if (fs.existsSync(oldDir)) {
                try {
                    fs.renameSync(oldDir, newDir);
                    console.log(`[LOG] Папка сессии переименована: ${oldDir} -> ${newDir}`);
                    sessionName = `session_${wid}`;
                    sessionRenamed = true;
                } catch (e) {
                    console.log('[LOG] Не удалось переименовать папку сессии:', e.message);
                }
            }
        }
        const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        fs.writeFileSync(path.join(sessionDir, 'number.txt'), wid, 'utf-8');
        // addNumberToActiveList(wid); // функция не определена, убираю вызов
        writeSessionStatus(sessionDir, 'active');
        myId = wid;
    } catch (e) {
        console.log('[LOG] Не удалось сохранить номер в number.txt:', e.message);
    }
    // Уведомление в Telegram о том, что аккаунт активирован
    if (telegramChatId) {
        try {
            const wid = client.info.wid._serialized;
            const cleanNumber = wid.replace(/@.*/, '');
            await axios.post('http://localhost:8000/send_activation', {
                chat_id: telegramChatId,
                text: `✅ Аккаунт с номером ${cleanNumber} успешно добавлен и активирован. Прогрев начнётся через 30 минут!\nдля прогревании сессии`
            });
            await axios.post('http://localhost:8000/session_activated', { chat_id: telegramChatId });
        } catch (e) {
            console.log('[LOG] Не удалось отправить уведомление в Telegram или FastAPI:', e.message);
        }
    }
    await setRandomStatus(client);
    await setRandomName(client);
    startAutoWarmup(client);

    // --- Обновление участников прогрева ---
    await updateWarmingUpParticipants();
    setInterval(updateWarmingUpParticipants, 5 * 60 * 1000); // обновлять каждые 5 минут

    // --- ПЕРИОДИЧЕСКИЕ РЕАКЦИИ КАЖДЫЕ 10 МИНУТ ---
    setInterval(periodicReaction, 10 * 60 * 1000); // <-- добавлено

    // --- Выбор оптимального прокси ---
    const selectedProxy = await getOptimalProxy();
    updateProxyExtension(selectedProxy);

    // === SUPABASE ACCOUNTS LOGIC ===
    try {
        const wid = client.info.wid._serialized;
        await supabase
            .from('accounts')
            .upsert({
                account_number: wid,
                chat_id: telegramChatId || null,
                timestamp: new Date().toISOString(),
                status: 'active',
                proxy: selectedProxy
            }, { onConflict: ['account_number'] });
        console.log('[SUPABASE] Аккаунт upsert в базу:', wid);
        // --- НАДЁЖНОЕ СПИСАНИЕ ЛИМИТА ПОЛЬЗОВАТЕЛЯ В SUPABASE ---
        if (telegramChatId) {
            try {
                const { data, error } = await supabase
                    .from('users')
                    .select('available_accounts')
                    .eq('chat_id', telegramChatId)
                    .single();
                console.log('[SUPABASE][DEBUG] Текущее значение available_accounts:', data ? data.available_accounts : 'нет данных');
                if (error) {
                    console.log('[SUPABASE] Ошибка получения available_accounts:', error.message);
                } else if (data && typeof data.available_accounts === 'number') {
                    const newValue = Math.max(0, data.available_accounts - 1);
                    const { error: updateError } = await supabase
                        .from('users')
                        .update({ available_accounts: newValue })
                        .eq('chat_id', telegramChatId);
                    if (updateError) {
                        console.log('[SUPABASE] Ошибка уменьшения лимита пользователя:', updateError.message);
                    } else {
                        console.log(`[SUPABASE] Лимит пользователя уменьшен: ${data.available_accounts} -> ${newValue}`);
                    }
                } else {
                    console.log('[SUPABASE] Не найдено поле available_accounts для пользователя!');
                }
            } catch (e) {
                console.log('[SUPABASE] Ошибка при уменьшении лимита:', e.message);
            }
        }
    } catch (e) {
        console.log('[SUPABASE] Ошибка upsert аккаунта:', e.message);
    }
});

client.on('disconnected', async (reason) => {
    if (client.info && client.info.wid && client.info.wid._serialized) {
        await markAccountInactive(client.info.wid._serialized);
    }
    // ... существующий код ...
    // Удаляем аккаунт из Supabase при любом отключении
    try {
        if (myId) await markAccountInactive(myId);
    } catch (e) {
        console.log('[SUPABASE] Ошибка удаления аккаунта при disconnected:', e.message);
    }
});

client.on('auth_failure', async () => {
    if (client.info && client.info.wid && client.info.wid._serialized) {
        await markAccountInactive(client.info.wid._serialized);
    }
    // ... существующий код ...
    // Удаляем аккаунт из Supabase при ошибке авторизации
    try {
        if (myId) await markAccountInactive(myId);
    } catch (e) {
        console.log('[SUPABASE] Ошибка удаления аккаунта при auth_failure:', e.message);
    }
});

// --- Автоматизация входа по номеру телефона ---
async function autoLoginByPhone(page, phoneNumber) {
    let maxRetries = 10;
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            // 1. Кликаем по "Войти по номеру телефона"
            let [phoneLoginBtn] = await page.$x("//div[@role='button']//div[contains(text(), 'Войти по номеру телефона')]");
            if (!phoneLoginBtn) {
                // fallback: клик по родителю
                [phoneLoginBtn] = await page.$x("//div[@role='button']//div[contains(text(), 'Войти по номеру телефона')]/..");
            }
            if (phoneLoginBtn) {
                await phoneLoginBtn.click();
                await page.waitForTimeout(1000);
            } else {
                console.log('[AUTOLOGIN] Кнопка "Войти по номеру телефона" не найдена');
                return;
            }

            // 2. Ждём появления поля для ввода номера
            const phoneInputSelector = 'input[aria-label="Введите свой номер телефона."]';
            await page.waitForSelector(phoneInputSelector, { timeout: 30000 });
            await page.focus(phoneInputSelector);
            // Выделяем весь текст (Ctrl+A) и удаляем (Delete)
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Delete');
            // Вводим '7' и затем остальные цифры номера по одной с задержкой
            const digits = String(phoneNumber).replace(/[^0-9]/g, '');
            await page.type(phoneInputSelector, '7', { delay: 100 });
            for (let i = 1; i < digits.length; i++) {
                await page.type(phoneInputSelector, digits[i], { delay: 100 });
            }
            await page.waitForTimeout(1000);

            // 3. Кликаем по кнопке "Далее"
            let [nextBtn] = await page.$x("//button//div[contains(., 'Далее')]/ancestor::button");
            if (!nextBtn) {
                // fallback: по селектору класса
                const nextBtnSelector = 'button.x889kno';
                await page.waitForSelector(nextBtnSelector, { timeout: 10000 });
                nextBtn = await page.$(nextBtnSelector);
            }
            if (nextBtn) {
                await nextBtn.click();
                await page.waitForTimeout(1000);
                // --- Запускаем таймер на 3 минуты после принятия номера ---
                if (authStartTimeout) clearTimeout(authStartTimeout);
                authStartTimeoutFired = false;
                authStartTimeout = setTimeout(async () => {
                    if (!isAuthenticated && !authStartTimeoutFired) {
                        authStartTimeoutFired = true;
                        try {
                            const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
                            if (fs.existsSync(sessionDir)) {
                                fs.rmSync(sessionDir, { recursive: true, force: true });
                                console.log('[AUTH START TIMEOUT] Папка сессии удалена:', sessionDir);
                            }
                        } catch (e) {
                            console.log('[AUTH START TIMEOUT] Ошибка удаления папки сессии:', e.message);
                        }
                        if (telegramChatId) {
                            try {
                                await axios.post('http://localhost:8000/send_error', {
                                    chat_id: telegramChatId,
                                    error_text: 'Авторизация не была завершена за 3 минуты после принятия номера. Попробуйте ещё раз.'
                                });
                            } catch (e) {
                                console.log('[AUTH START TIMEOUT] Не удалось отправить уведомление в Telegram:', e.message);
                            }
                        }
                        process.exit(1);
                    }
                }, 180000); // 3 минуты
            } else {
                console.log('[AUTOLOGIN] Кнопка "Далее" не найдена');
                return;
            }

            // 4. Ждём появления поля для кода (если нужно)
            await page.waitForSelector('input[type="tel"], input[type="text"]', { timeout: 60000 });
            console.log('[AUTOLOGIN] Вход по номеру телефона выполнен успешно!');
            return; // если всё успешно — выходим из цикла
        } catch (e) {
            attempt++;
            const errMsg = e && e.message ? e.message : String(e);
            console.log(`[AUTOLOGIN] Ошибка автоматизации входа по номеру (попытка ${attempt}):`, errMsg);
            if (errMsg.includes('ERR_SOCKET_NOT_CONNECTED') || errMsg.includes('net::ERR') || errMsg.includes('Timeout') || errMsg.includes('timeout')) {
                try {
                    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
                    console.log('[AUTOLOGIN] Страница перезагружена после ошибки.');
                } catch (reloadErr) {
                    console.log('[AUTOLOGIN] Ошибка при перезагрузке страницы:', reloadErr.message);
                }
                await page.waitForTimeout(5000);
            } else {
                // Для других ошибок тоже делаем паузу и пробуем снова
                await page.waitForTimeout(5000);
            }
        }
    }
    console.log('[AUTOLOGIN] Не удалось автоматизировать вход по номеру после нескольких попыток');
}

// ... существующий код ...
// --- Универсальный клик ---
async function tryAllClicks(page, elementHandle) {
    try { await elementHandle.click(); return true; } catch {}
    try { await page.evaluate(el => el.click(), elementHandle); return true; } catch {}
    try { await elementHandle.focus(); await page.keyboard.press('Enter'); return true; } catch {}
    return false;
}

// --- Отправка кода и кнопки отмены в Telegram ---
async function sendCodeToTelegram(code, chatId, sessionName, phoneNumber) {
    const sessionHash = require('crypto').createHash('md5').update(String(sessionName)).digest('hex');
        const cancelButton = {
            text: '❌ Отменить авторизацию',
            callback_data: `cancel_auth|${sessionHash}`
        };
    const safeCode = escapeHtml(code);
    const text = `Вам нужно ввести этот код в Whatsapp:\n<b>${safeCode}</b>\nУ вас есть одна минута на ввод кода!`;
    let messageId = null;
    let needFallback = false;

    if (phoneLoginMessageId) {
        // Редактируем предыдущее сообщение
        try {
            const res = await axios.post('http://localhost:8000/edit_message', {
            chat_id: chatId,
                message_id: phoneLoginMessageId,
                text: text,
                reply_markup: {
                    inline_keyboard: [[cancelButton]]
                }
            });
            console.log('[DEBUG] Ответ от /edit_message:', res.data);
            // Если редактирование прошло успешно, не делаем fallback
            if (res.data && res.data.status === 'ok' && res.data.edited) {
                messageId = phoneLoginMessageId;
                console.log('[DEBUG] Сообщение успешно отредактировано, fallback не требуется');
                return messageId;
            } else {
                needFallback = true;
            }
        } catch (e) {
            needFallback = true;
            console.log('[AUTOLOGIN] Не удалось отредактировать сообщение с кодом:', e?.response?.data || e.message);
        }
    } else {
        needFallback = true;
    }

    // Fallback: если не удалось отредактировать — отправляем новое сообщение
    if (needFallback) {
        try {
            const res = await axios.post('http://localhost:8000/send_qr', {
                chat_id: chatId,
                qr_data: '',
                is_bytes: false,
            session_name: sessionName,
            session_hash: sessionHash,
            reply_markup: {
                inline_keyboard: [[cancelButton]]
                },
                text: text
            });
            console.log('[DEBUG] Ответ от /send_qr:', res.data);
            if (res.data && res.data.message_id) {
                messageId = res.data.message_id;
                phoneLoginMessageId = messageId;
            }
            console.log('[DEBUG] После /send_qr: messageId =', messageId, 'phoneLoginMessageId =', phoneLoginMessageId);
        } catch (e) {
            console.log('[AUTOLOGIN] Не удалось отправить сообщение с кодом:', e?.response?.data || e.message);
        }
    }
    return messageId;
}

// --- Ожидание появления кода и отправка в Telegram ---
async function waitForAndSendCode(page, chatId, sessionName, phoneNumber) {
    if (isAuthenticated) {
        return;
    }
    try {
        await page.waitForSelector('span.x2b8uid', { timeout: 60000 });
        const code = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('span.x2b8uid')).map(el => el.textContent).join('');
        });
        // Проверяем, что код 6-8 цифр или похож на код
        if (/^\d{6,8}$/.test(code) || /^[A-Z0-9]{4}-[A-Z0-9]{4,8}$/i.test(code)) {
            const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
            const lastCodePath = path.join(sessionDir, 'last_code.txt');
            let lastSentTelegramCode = null;
            if (fs.existsSync(lastCodePath)) {
                lastSentTelegramCode = fs.readFileSync(lastCodePath, 'utf-8').trim();
            }
            if (code !== lastSentTelegramCode) {
                const messageId = await sendCodeToTelegram(code, chatId, sessionName, phoneNumber);
                if (messageId) phoneLoginMessageId = messageId;
                fs.writeFileSync(lastCodePath, code, 'utf-8');
                // --- ОТМЕНЯЕМ таймер на 3 минуты, если код отправлен ---
                if (authStartTimeout) {
                    clearTimeout(authStartTimeout);
                    authStartTimeout = null;
                }
                // --- Запускаем таймер на 2 минуты ---
                if (codeTimeout) clearTimeout(codeTimeout);
                codeTimeoutFired = false;
                codeTimeout = setTimeout(async () => {
                    if (!isAuthenticated && !codeTimeoutFired) {
                        codeTimeoutFired = true;
                        // Удаляем сообщение с кодом, если оно есть
                        if (typeof phoneLoginMessageId !== 'undefined' && chatId) {
                            try {
                                const delParams = { chat_id: chatId, message_id: phoneLoginMessageId };
                                await axios.post('http://localhost:8000/delete_message', delParams);
                                console.log('[TIMEOUT] Сообщение с кодом удалено:', delParams);
    } catch (e) {
                                console.log('[TIMEOUT] Не удалось удалить сообщение с кодом:', e.message);
                            }
                        }
                        // Удаляем сессию
                        try {
                            const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
                            if (fs.existsSync(sessionDir)) {
                                fs.rmSync(sessionDir, { recursive: true, force: true });
                                console.log('[TIMEOUT] Папка сессии удалена:', sessionDir);
                            }
                        } catch (e) {
                            console.log('[TIMEOUT] Ошибка удаления папки сессии:', e.message);
                        }
                        // Отправляем уведомление в Telegram
                        if (chatId) {
                            try {
                                await axios.post('http://localhost:8000/send_error', {
                                    chat_id: chatId,
                                    error_text: 'Вы не ввели код в течение 2 минут. Добавьте аккаунт еще раз.'
                                });
                            } catch (e) {
                                console.log('[TIMEOUT] Не удалось отправить уведомление в Telegram:', e.message);
                            }
                        }
                        process.exit(1);
                    }
                }, 120000); // 2 минуты
            }
        }
    } catch (e) {
        // Ошибка при получении кода — ничего не делаем, не запускаем лишних таймеров
    }
}

// --- Endpoint для отмены авторизации (через HTTP POST /cancel_auth) ---
const cancelApp = express();
cancelApp.use(express.json());
cancelApp.post('/cancel_auth', async (req, res) => {
    const { sessionName, phoneNumber, chatId } = req.body;
    try {
        if (chatId) {
            const cancelFlag = path.join(__dirname, `cancelled_${chatId}.flag`);
            fs.writeFileSync(cancelFlag, String(Date.now()), 'utf-8');
            console.log(`[CANCEL_AUTH] Флаг отмены создан: ${cancelFlag}`);
        }
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', detail: e.message });
    }
});
cancelApp.listen(3010, () => {
    console.log('Cancel auth server listening on port 3010');
});

// --- Вызов после autoLoginByPhone ---
// ... в обработчике QR-кода ...
// (удалено, вызов уже есть в client.on('qr', ...))
    // ... существующий код ...

let codeTimeout = null;
let codeTimeoutFired = false;
let authStartTimeout = null;
let authStartTimeoutFired = false;

// --- Тестовая команда для отправки фото ---
client.on('message', async (msg) => {
    if (msg.body && msg.body.trim() === '/testphoto') {
        try {
            const chat = await msg.getChat();
            console.log('[TESTPHOTO] Получена команда /testphoto, пробую отправить фото...');
            const result = await forwardRandomMediaFromChat(client, chat, MediaType.IMAGE);
            if (result) {
                await msg.reply('Фото успешно отправлено!');
        } else {
                await msg.reply('Не удалось отправить фото. Проверьте логи.');
            }
        } catch (e) {
            console.log('[TESTPHOTO] Ошибка при отправке фото:', e.message);
            await msg.reply('Ошибка при отправке фото: ' + e.message);
        }
    }
});

// ... существующий код ...
// --- Отправка сообщения о подготовке входа и сохранение messageId ---
let phoneLoginMessageId = null;
async function sendPhoneLoginPreparing(chatId) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: 'Готовим вход по номеру телефона... Ожидайте код для входа!',
                parse_mode: 'HTML'
            })
        });
        const data = await res.json();
        if (data && data.result && data.result.message_id) {
            phoneLoginMessageId = data.result.message_id;
        }
    } catch (e) {
        console.log('[AUTOLOGIN] Не удалось отправить сообщение о подготовке входа:', e.message);
    }
}

// --- Изменяем sendCodeToTelegram: если есть phoneLoginMessageId, редактируем сообщение, иначе отправляем новое ---
async function sendCodeToTelegram(code, chatId, sessionName, phoneNumber) {
    const sessionHash = require('crypto').createHash('md5').update(String(sessionName)).digest('hex');
    const cancelButton = {
        text: '❌ Отменить авторизацию',
        callback_data: `cancel_auth|${sessionHash}`
    };
    const safeCode = escapeHtml(code);
    const text = `Вам нужно ввести этот код в Whatsapp:\n<b>${safeCode}</b>\nУ вас есть одна минута на ввод кода!`;
    if (phoneLoginMessageId) {
        // Редактируем предыдущее сообщение
        try {
            await axios.post('http://localhost:8000/edit_message', {
                chat_id: chatId,
                message_id: phoneLoginMessageId,
                text: text,
                reply_markup: {
                    inline_keyboard: [[cancelButton]]
                }
            });
        } catch (e) {
            console.log('[AUTOLOGIN] Не удалось отредактировать сообщение с кодом:', e.message);
        }
    } else {
        // Отправляем новое сообщение (fallback)
        await axios.post('http://localhost:8000/send_qr', {
            chat_id: chatId,
            qr_data: '',
            is_bytes: false,
            session_name: sessionName,
            session_hash: sessionHash,
            reply_markup: {
                inline_keyboard: [[cancelButton]]
            },
            text: text
        });
    }
}

// --- Вызов sendPhoneLoginPreparing при старте автологина по номеру ---
// В начале autoLoginByPhone (до ввода номера):
if (phoneNumber && telegramChatId) {
    sendPhoneLoginPreparing(telegramChatId);
}
// ... существующий код ...


// --- Новый: простой хеш строки ---
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}


// --- Простая функция логирования ошибок в файл ---
function logErrorToFile(msg) {
    const ERROR_LOG_FILE = path.join(__dirname, 'error.log');
    fs.appendFileSync(ERROR_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}





    // --- ПЕРИОДИЧЕСКИЕ РЕАКЦИИ КАЖДЫЕ 10 МИНУТ ---
    async function periodicReaction() {
        if (!client || !client.info || !client.info.wid || !client.info.wid._serialized || !isAuthenticated) return;
        const myId = client.info.wid._serialized;

        // Реакция только в ЛС из warming_up
        try {
            for (const userId of WARMUP_PARTICIPANTS) {
                if (userId === myId) continue;
                const chat = await client.getChatById(userId);
                const messages = await chat.fetchMessages({ limit: 20 });
                for (let msg of messages.reverse()) {
                    if (!msg.fromMe && (!msg._data.reactions || !msg._data.reactions.some(r => r.senderId === myId))) {
                        await msg.react(getRandom(REACTIONS));
                        // console.log(`[PERIODIC REACTION] Реакция поставлена в ЛС ${userId}`); // УБРАНО
                        break;
                    }
                }
            }
        } catch (e) {
            console.log('[PERIODIC REACTION] Ошибка при попытке поставить реакцию в ЛС:', e.message);
        }
    }
// ... existing code ...
        // No changes were specified, so the code remains the same
    // Первый запуск при готовности
    // Removed the misplaced function call and closing parenthesis
    // ... existing code ...
    // ... existing code ...

    // --- Автоматическое добавление нового участника в прогрев, если номеров недостаточно ---
    // Улучшение 9, 10, 11, 13: Уточнить логику group_join
    client.on('group_join', async (notification) => {
    // This functionality is removed as we are no longer using groups.
    });

    // ... существующий код ...
    const writeSessionStatus = (sessionDir, status) => {
        try {
            fs.writeFileSync(path.join(sessionDir, 'status.txt'), status, 'utf-8');
        } catch (e) {
            console.log('[STATUS] Не удалось записать status.txt:', e.message);
        }
    };
    // ... existing code ...

    // --- Динамическое получение inviteUrl ---
    function getInviteUrl() {
        delete require.cache[require.resolve('./config')];
        const config = require('./config');
        return config.inviteUrl;
    }

    // Везде, где используется client.getChats(), добавить try/catch и повторные попытки при ошибках Execution context
    async function safeGetChats(client, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const chats = await client.getChats();
                // Патчим участников вручную для каждого чата
                for (const chat of chats) {
                    if (Array.isArray(chat.participants)) {
                        chat.participants = chat.participants.filter(p => p && p.id && p.id._serialized);
                    }
                }
                return chats;
            } catch (e) {
                if (e.message && e.message.includes('Execution context')) {
                    if (attempt === maxAttempts) throw e;
                    await new Promise(res => setTimeout(res, 2000));
                    continue;
                } else {
                    throw e;
                }
            }
        }
        return [];
    }

    // ... существующий код ...
    function checkCancelFlagAndExit() {
        if (!telegramChatId || !sessionName) return;
        const cancelFlag = path.join(__dirname, `cancelled_${telegramChatId}_${sessionName}.flag`);
        if (fs.existsSync(cancelFlag)) {
            console.log('[CANCEL] Обнаружен флаг отмены, завершаю клиент и удаляю сессию.');
            if (client && typeof client.destroy === 'function') {
                client.destroy().then(() => process.exit(0));
            } else {
                process.exit(0);
            }
        }
    }

    console.log('[DEBUG][START] index.js запущен с аргументами:', process.argv);

// ... existing code ...
    // --- Экранирование только содержимого кода ---
    function escapeHtml(text) {
        return String(text).replace(/[&<>]/g, function (m) {
            return ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;'
            })[m];
        });
    }

    // Функция для поддержания сессии в активном состоянии
    async function keepSessionActive(client) {
        if (!client || !client.info || !isAuthenticated) return;
        try {
            const selfChatId = client.info.wid._serialized;
            const chat = await client.getChatById(selfChatId);
            // Короткая имитация набора текста - надежный сигнал присутствия
            await chat.sendStateTyping();
            await new Promise(res => setTimeout(res, 2000)); // Пауза 2 секунды
            await chat.clearState();
            // console.log('[KEEPALIVE] Сигнал активности отправлен.');
        } catch (e) {
            console.log('[KEEPALIVE] Не удалось отправить сигнал активности:', e.message);
        }
    }



// --- Автоматизация входа по номеру телефона ---
async function autoLoginByPhone(page, phoneNumber) {
    let maxRetries = 10;
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            // 1. Кликаем по "Войти по номеру телефона"
            let [phoneLoginBtn] = await page.$x("//div[@role='button']//div[contains(text(), 'Войти по номеру телефона')]");
            if (!phoneLoginBtn) {
                // fallback: клик по родителю
                [phoneLoginBtn] = await page.$x("//div[@role='button']//div[contains(text(), 'Войти по номеру телефона')]/..");
            }
            if (phoneLoginBtn) {
                await phoneLoginBtn.click();
                await page.waitForTimeout(1000);
            } else {
                console.log('[AUTOLOGIN] Кнопка "Войти по номеру телефона" не найдена');
                return;
            }

            // 2. Ждём появления поля для ввода номера
            const phoneInputSelector = 'input[aria-label="Введите свой номер телефона."]';
            await page.waitForSelector(phoneInputSelector, { timeout: 30000 });
            await page.focus(phoneInputSelector);
            // Выделяем весь текст и удаляем
            await page.evaluate((selector) => {
                const input = document.querySelector(selector);
                if (input) {
                    input.select();
                }
            }, phoneInputSelector);
            await page.keyboard.press('Backspace');
            // Вводим номер по символам (имитация ручного ввода)
            await page.type(phoneInputSelector, String(phoneNumber), { delay: 100 });
            await page.waitForTimeout(1000);

            // 3. Кликаем по кнопке "Далее"
            let [nextBtn] = await page.$x("//button//div[contains(., 'Далее')]/ancestor::button");
            if (!nextBtn) {
                // fallback: по селектору класса
                const nextBtnSelector = 'button.x889kno';
                await page.waitForSelector(nextBtnSelector, { timeout: 10000 });
                nextBtn = await page.$(nextBtnSelector);
            }
            if (nextBtn) {
                await nextBtn.click();
                await page.waitForTimeout(1000);
                // --- Запускаем таймер на 3 минуты после принятия номера ---
                if (authStartTimeout) clearTimeout(authStartTimeout);
                authStartTimeoutFired = false;
                authStartTimeout = setTimeout(async () => {
                    if (!isAuthenticated && !authStartTimeoutFired) {
                        authStartTimeoutFired = true;
                        try {
                            const sessionDir = path.join(__dirname, `.wwebjs_auth/${sessionName}`);
                            if (fs.existsSync(sessionDir)) {
                                fs.rmSync(sessionDir, { recursive: true, force: true });
                                console.log('[AUTH START TIMEOUT] Папка сессии удалена:', sessionDir);
                            }
                        } catch (e) {
                            console.log('[AUTH START TIMEOUT] Ошибка удаления папки сессии:', e.message);
                        }
                        if (telegramChatId) {
                            try {
                                await axios.post('http://localhost:8000/send_error', {
                                    chat_id: telegramChatId,
                                    error_text: 'Авторизация не была завершена за 3 минуты после принятия номера. Попробуйте ещё раз.'
                                });
                            } catch (e) {
                                console.log('[AUTH START TIMEOUT] Не удалось отправить уведомление в Telegram:', e.message);
                            }
                        }
                        process.exit(1);
                    }
                }, 180000); // 3 минуты
            } else {
                console.log('[AUTOLOGIN] Кнопка "Далее" не найдена');
                return;
            }

            // 4. Ждём появления поля для кода (если нужно)
            await page.waitForSelector('input[type="tel"], input[type="text"]', { timeout: 60000 });
            console.log('[AUTOLOGIN] Вход по номеру телефона выполнен успешно!');
            return; // если всё успешно — выходим из цикла
        } catch (e) {
            attempt++;
            const errMsg = e && e.message ? e.message : String(e);
            console.log(`[AUTOLOGIN] Ошибка автоматизации входа по номеру (попытка ${attempt}):`, errMsg);
            if (errMsg.includes('ERR_SOCKET_NOT_CONNECTED') || errMsg.includes('net::ERR') || errMsg.includes('Timeout') || errMsg.includes('timeout')) {
                try {
                    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
                    console.log('[AUTOLOGIN] Страница перезагружена после ошибки.');
                } catch (reloadErr) {
                    console.log('[AUTOLOGIN] Ошибка при перезагрузке страницы:', reloadErr.message);
                }
                await page.waitForTimeout(5000);
            } else {
                // Для других ошибок тоже делаем паузу и пробуем снова
                await page.waitForTimeout(5000);
            }
        }
    }
    console.log('[AUTOLOGIN] Не удалось автоматизировать вход по номеру после нескольких попыток');
}

// === SUPABASE ACCOUNTS FUNCTIONS ===

// Добавить аккаунт
async function addAccount(accountData) {
    const { data, error } = await supabase
        .from('accounts')
        .insert([accountData]);
    if (error) throw error;
    return data;
}

// Получить аккаунт по номеру
async function getAccountByNumber(account_number) {
    const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('account_number', account_number)
        .single();
    if (error) throw error;
    return data;
}

// Обновить аккаунт
async function updateAccount(account_number, updateData) {
    const { data, error } = await supabase
        .from('accounts')
        .update(updateData)
        .eq('account_number', account_number);
    if (error) throw error;
    return data;
}

// Удалить аккаунт
async function removeAccount(account_number) {
    const { data, error } = await supabase
        .from('accounts')
        .delete()
        .eq('account_number', account_number);
    if (error) throw error;
    return data;
}

// Удалить аккаунт из базы
async function deleteAccountFromSupabase(wid) {
    try {
        await removeAccount(wid);
        console.log('[SUPABASE] Аккаунт удалён из базы:', wid);
    } catch (e) {
        console.log('[SUPABASE] Ошибка удаления аккаунта:', e.message);
    }
}

// После завершения прогрева
async function markAccountFinished(wid) {
    await deleteAccountFromSupabase(wid);
}

// При слёте сессии
async function markAccountInactive(wid) {
    await deleteAccountFromSupabase(wid);
}

// ... существующий код ...
async function forceSetUserAgentCDP(client, userAgent) {
    try {
        let browser = client.pupBrowser || (client._client && client._client._browser);
        if (!browser) {
            if (client.pupPage && client.pupPage.browser) {
                browser = client.pupPage.browser();
            }
        }
        if (browser) {
            const pages = await browser.pages();
            for (const page of pages) {
                if (page && page._client && typeof page._client.send === 'function') {
                    await page._client.send('Network.setUserAgentOverride', { userAgent });
                    console.log('[CDP] User-Agent установлен через CDP (force):', userAgent);
                }
            }
        } else {
            console.log('[CDP] Не удалось получить browser для установки user-agent через CDP');
        }
    } catch (e) {
        console.log('[CDP] Ошибка forceSetUserAgentCDP:', e.message);
    }
}

client.on('ready', async () => {
    await forceSetUserAgentCDP(client, userAgent);
    setTimeout(() => forceSetUserAgentCDP(client, userAgent), 2000);
    // ... существующий код ...
});

client.on('authenticated', async () => {
    await forceSetUserAgentCDP(client, userAgent);
});
// ... существующий код ...

// === Глобальный массив участников прогрева ===
let WARMUP_PARTICIPANTS = [];

// Функция для обновления участников прогрева из Supabase
async function updateWarmingUpParticipants() {
    try {
        const { data, error } = await supabase
            .from('accounts')
            .select('account_number')
            .eq('status', 'active');
        if (!error && data) {
            WARMUP_PARTICIPANTS = data.map(acc => acc.account_number);
            // console.log('[DEBUG] WARMUP_PARTICIPANTS обновлены:', WARMUP_PARTICIPANTS);
        }
    } catch (e) {
        console.log('[SUPABASE] Ошибка обновления WARMUP_PARTICIPANTS:', e.message);
    }
}

// --- Выбор оптимального прокси для аккаунта ---
async function getOptimalProxy() {
    // Получаем все активные прокси из Supabase
    const { data: activeAccounts, error: accErr } = await supabase
        .from('accounts')
        .select('proxy')
        .eq('status', 'active');
    // Получаем все прокси из proxy.txt
    const allProxies = fs.readFileSync(PROXY_TXT_PATH, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    // Считаем количество аккаунтов на каждом прокси
    const proxyCount = {};
    for (const proxy of allProxies) proxyCount[proxy] = 0;
    for (const acc of (activeAccounts || [])) {
        if (acc.proxy && proxyCount.hasOwnProperty(acc.proxy)) {
            proxyCount[acc.proxy]++;
        }
    }
    // Свободные прокси
    const freeProxies = allProxies.filter(proxy => proxyCount[proxy] === 0);
    if (freeProxies.length > 0) {
        return freeProxies[Math.floor(Math.random() * freeProxies.length)];
    }
    // Если все заняты — выбираем прокси с минимальным количеством аккаунтов
    let minCount = Infinity;
    let candidates = [];
    for (const proxy of allProxies) {
        if (proxyCount[proxy] < minCount) {
            minCount = proxyCount[proxy];
            candidates = [proxy];
        } else if (proxyCount[proxy] === minCount) {
            candidates.push(proxy);
        }
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}
