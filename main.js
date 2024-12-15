import Web3 from 'web3';
import axios from 'axios';
import fs from 'fs';
import chalk from 'chalk';
import https from 'https';
import url from 'url';

// Membaca proxy dari file proxy.txt
function readProxySettings(file) {
    const proxies = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim());
    return proxies.map(proxyString => {
        const parsedUrl = url.parse(proxyString.trim());

        const protocol = parsedUrl.protocol || 'http:';
        const host = parsedUrl.hostname;
        const port = parsedUrl.port;
        const auth = parsedUrl.auth ? parsedUrl.auth.split(':') : null;

        return {
            protocol,
            host,
            port,
            username: auth ? auth[0] : null,
            password: auth ? auth[1] : null
        };
    });
}

// Fungsi untuk mendapatkan IP dari proxy
async function getProxyIP(proxy) {
    try {
        const response = await axios.get('https://httpbin.org/ip', {
            proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }), 
            timeout: 5000 
        });
        const ip = response.data.origin;
        console.log(`Menggunakan proxy IP: ${ip}`);
        return ip;
    } catch (error) {
        console.error('Gagal mendapatkan IP proxy:', error.message);
        return null;
    }
}

// Konfigurasi proxy
const proxySettings = readProxySettings('proxy.txt');
const httpsAgent = new https.Agent({ rejectUnauthorized: false }); 
const RPC = 'https://rpc.moksha.vana.org'; 
const web3 = new Web3(new Web3.providers.HttpProvider(RPC));
const PRIVATE_KEYS_FILE = 'PrivateKeys.txt'; 
const ROUTER_ADDRESS = '0xCFd016891E654869BfEd5D9E9bb76559dF593dbc'; 
const ROUTER_ABI = [
    {
        "name": "addFile",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
        "inputs": [
            { "internalType": "string", "name": "url", "type": "string" },
            { "internalType": "string", "name": "encryptedKey", "type": "string" }
        ]
    }
];

// Membaca private key dan kode referensi dari file
function readPrivateKeys(file) {
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line.trim()) 
        .map(line => {
            const [privateKey, refCode] = line.split(',');
            return { privateKey: privateKey.trim(), refCode: refCode?.trim() };
        });
}

// Mendapatkan pesan (nonce)
async function getMessage(address, proxy) {
    try {
        const response = await axios.post('https://api.datapig.xyz/api/get-message', { address }, {
            proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            },
            httpsAgent  
        });
        return response.data.message;
    } catch (error) {
        console.error('Gagal mendapatkan pesan:', error.response?.data || error.message);
    }
}

// Menandatangani pesan
async function signMessage(privateKey, message) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const signature = account.sign(message);
        return { signature: signature.signature, address: account.address };
    } catch (error) {
        console.error('Gagal menandatangani pesan:', error.message);
    }
}

// Login untuk mendapatkan token
async function login(address, message, signature, proxy) {
    try {
        const response = await axios.post('https://api.datapig.xyz/api/login', { signature, address, message }, {
            proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            },
            httpsAgent  
        });
        return response.data.token;
    } catch (error) {
        console.error('Login gagal:', error.response?.data || error.message);
    }
}

// Mendapatkan informasi token
async function getTokens(token, proxy) {
    try {
        const response = await axios.get('https://api.datapig.xyz/api/tokens', {
            headers: { Authorization: `Bearer ${token}` },
            proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            },
            httpsAgent  
        });
        return response.data;
    } catch (error) {
        console.error('Gagal mendapatkan token:', error.response?.data || error.message);
    }
}

// Membuat analisis
async function generateAnalysis(token, address, preferences, signature, refCode, proxy) {
    try {
        const response = await axios.post(
            'https://api.datapig.xyz/api/submit',
            { address, preferences, signature, refCode },
            { headers: { Authorization: `Bearer ${token}` }, proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            }, httpsAgent }
        );
        return response.data;
    } catch (error) {
        if (error.response?.status === 429) {
            console.log('Mencapai batas harian, melewati wallet ini.');
            return null;
        }
        console.error('Gagal membuat analisis:', error.response?.data || error.message);
    }
}

// Konfirmasi hash transaksi
async function confirmHash(token, address, confirmedTxHash, proxy) {
    try {
        const response = await axios.post(
            'https://api.datapig.xyz/api/invitedcode',
            { address, confirmedTxHash },
            { headers: { Authorization: `Bearer ${token}` }, proxy: {
                host: proxy.host,
                port: proxy.port,
                auth: {
                    username: proxy.username,
                    password: proxy.password
                }
            }, httpsAgent }
        );
        return response.data;
    } catch (error) {
        console.error('Gagal mengonfirmasi hash transaksi:', error.response?.data || error.message);
    }
}

// Minting file
async function mintFile(privateKey, url, encryptedKey, retries = 3, proxy) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const contract = new web3.eth.Contract(ROUTER_ABI, ROUTER_ADDRESS);

        const fullUrl = `ipfs://${url}`;
        const gasEstimate = await contract.methods.addFile(fullUrl, encryptedKey).estimateGas({ from: account.address });
        const gasPrice = await web3.eth.getGasPrice();

        const transaction = {
            to: ROUTER_ADDRESS,
            data: contract.methods.addFile(fullUrl, encryptedKey).encodeABI(),
            gas: gasEstimate,
            gasPrice,
        };

        const signedTransaction = await web3.eth.accounts.signTransaction(transaction, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTransaction.rawTransaction);

        console.log('Minting berhasil, hash transaksi:', receipt.transactionHash);
        return receipt.transactionHash;
    } catch (error) {
        console.error(`Gagal minting file (percobaan ke ${4 - retries}):`, error.message);
        if (retries > 1) {
            console.log('Coba lagi dalam 1 menit...');
            await new Promise(resolve => setTimeout(resolve, 60000));
            return mintFile(privateKey, url, encryptedKey, retries - 1, proxy);
        } else {
            console.error('Semua percobaan gagal.');
            throw new Error('Minting gagal');
        }
    }
}

// Membuat preferensi acak
function generateRandomPreferences(tokens) {
    const categories = [
        'Layer 1', 
        'Governance', 
        'Launch Pad', 
        'GameFi & Metaverse',
        'NFT & Collectibles',
        'Layer 2 & Scaling',
        'Infrastructure',
        'Meme & Social',
        'DeFi',
        'DePIN',
        'Lainnya',
        'AI',
        'Liquid Staking',
        'RWA',
        'Murad Picks'
    ];

    const randomCategories = categories.sort(() => 0.5 - Math.random()).slice(0, 3);
    const matchedTokens = tokens.filter(token =>
        token.categories.some(category => randomCategories.includes(category))
    );
    const selectedTokens = matchedTokens
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.random() < 0.5 ? 13 : 14);

    const likes = selectedTokens.reduce((acc, token) => {
        acc[token.id] = Math.random() < 0.5; 
        return acc;
    }, {});

    return { categories: randomCategories, likes };
}

// Menampilkan ASCII art dengan warna pelangi
const ASCII_ART = `
 _______                          
|     __|.--.--.---.-.-----.---.-.
|__     ||  |  |  _  |-- __|  _  |
|_______||___  |___._|_____|___._|
         |_____|
`;

const RAINBOW_COLORS = [
    chalk.red, chalk.green, chalk.yellow, chalk.blue, chalk.magenta, chalk.cyan
];

// Menampilkan header dengan warna pelangi
function printHeader() {
    let colorIndex = 0;
    for (const line of ASCII_ART.split('\n')) {
        console.log(RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length](line));
        colorIndex++;
    }
}

// Fungsi utama
async function mainExecution() {
    printHeader();
    const privateKeyData = readPrivateKeys(PRIVATE_KEYS_FILE);

    // Proses semua wallet
    for (const { privateKey, refCode } of privateKeyData) {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const address = account.address;
        console.log(chalk.cyan('==========================================================='));
        console.log(chalk.cyan(`Alamat saat ini: ${address}`));

        let isMintingSuccess = false; // Untuk mengecek jika minting berhasil
        let attempts = 0; // Melacak jumlah percobaan

        let retryWithNewProxy = false; // Flag untuk mengecek jika perlu retry dengan proxy lain

        // Coba maksimal 3 kali untuk setiap wallet
        while (attempts < 3) {
            attempts++;
            console.log(chalk.yellow(`Mulai percobaan ke-${attempts} untuk wallet: ${address}`));

            // Menggunakan proxy yang dipilih secara acak
            const proxy = proxySettings[Math.floor(Math.random() * proxySettings.length)];
            const ip = await getProxyIP(proxy);

            try {
                // Proses utama untuk wallet ini
                const message = await getMessage(address, proxy);
                if (!message) throw new Error('Tidak dapat mengambil pesan.');

                const { signature } = await signMessage(privateKey, message);
                if (!signature) throw new Error('Gagal menandatangani pesan.');

                const token = await login(address, message, signature, proxy);
                if (!token) throw new Error('Gagal login.');

                const tokens = await getTokens(token, proxy);
                if (!tokens) throw new Error('Gagal mengambil token.');

                const preferences = generateRandomPreferences(tokens);

                const analysisSignature = await signMessage(privateKey, "Pesan tanda tangan analisis");
                if (!analysisSignature) throw new Error('Gagal menandatangani analisis.');

                const analysis = await generateAnalysis(token, address, preferences, analysisSignature.signature, refCode, proxy);
                if (!analysis) throw new Error('Gagal membuat analisis.');

                const txHash = await mintFile(privateKey, analysis.ipfs_hash, analysis.encryptedKey, 3, proxy);
                const confirmedHash = await confirmHash(token, address, txHash, proxy);

                console.log('Transaksi telah dikonfirmasi:', confirmedHash);
                isMintingSuccess = true;
                break; // Berhenti mencoba jika berhasil
            } catch (error) {
                console.error(`Percobaan ke-${attempts} gagal:`, error.message);

                // Jika error karena batas harian (status 429), langsung lanjutkan ke wallet berikutnya
                if (error.response && error.response.status === 429) {
                    console.log(chalk.yellow(`Mencapai batas harian, melewati wallet ini: ${address}`));
                    break; // Jangan mencoba lagi dan lanjut ke wallet berikutnya
                }

                // Jika error adalah masalah socket hang up atau Internal Server Error, coba lagi dengan proxy berbeda
                if (error.code === 'ECONNRESET' || error.message.includes('socket hang up') || error.message.includes('Internal Server Error')) {
                    console.log(chalk.yellow(`Terjadi masalah koneksi atau server, mencoba lagi dengan proxy lain dalam 1 menit...`));
                    retryWithNewProxy = true;
                    await new Promise(resolve => setTimeout(resolve, 60000)); // Tunggu 1 menit
                } else {
                    // Jika error lain, lanjutkan ke wallet berikutnya
                    break;
                }
            }

            // Jika kita perlu mencoba lagi dengan proxy lain, ulangi percobaan tanpa lanjut ke wallet berikutnya
            if (retryWithNewProxy) {
                console.log(chalk.yellow('Mencoba dengan proxy lain...'));
                continue; // Lanjutkan mencoba dengan proxy yang berbeda
            }

            // Jika minting tidak berhasil setelah percobaan, lanjutkan ke wallet berikutnya
            if (!isMintingSuccess) {
                console.log(chalk.red(`Minting untuk wallet ${address} gagal, melanjutkan ke wallet berikutnya...`));
            }
        }
    }

    // Delay acak antara 7 hingga 77 menit setelah semua wallet diproses
    const randomDelayInSeconds = randomTimeDelay(); // Menghitung waktu acak dalam detik
    console.log(chalk.green(`Menunggu selama ${randomDelayInSeconds} detik sebelum melanjutkan...`));
    await new Promise(resolve => setTimeout(resolve, randomDelayInSeconds * 1000)); // Delay dalam milidetik

    // Menjalankan kembali setelah delay acak
    mainExecution();
}

// Fungsi untuk mendapatkan waktu acak antara 7 hingga 77 menit dalam detik
function randomTimeDelay() {
    const minMinutes = 7;
    const maxMinutes = 77;
    const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    return randomMinutes * 60; // Mengkonversi menit ke detik
}

mainExecution();  // Memulai eksekusi
