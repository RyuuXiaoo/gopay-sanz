const express = require('express');
const path = require('path');
const { ImageUploadService } = require("node-upload-images");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const FormData = require("form-data");
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

class GoMerchant {
    constructor() {
        this.baseUrl = 'https://api.gobiz.co.id';
        this.clientId = 'go-biz-web-new';
        this.appId = 'go-biz-web-dashboard';
        this.uniqueId = uuidv4();
    }

    headers(token = null) {
        const h = {
            'Accept': 'application/json, text/plain, */*',
            'Authentication-Type': 'go-id',
            'X-PhoneMake': 'Android 10',
            'X-PhoneModel': 'K',
            'x-DeviceOS': 'Web',
            'X-Platform': 'Web',
            'X-User-Type': 'merchant',
            'x-appId': this.appId,
            'x-uniqueid': this.uniqueId,
            'X-AppVersion': 'platform-v3.101.0-8918927d',
            'Gojek-Country-Code': 'ID',
            'Gojek-Timezone': 'Asia/Jakarta',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'
        };
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    }

    convertCRC16(str) {
        let crc = 0xFFFF;
        const strlen = str.length;
        for (let c = 0; c < strlen; c++) {
            crc ^= str.charCodeAt(c) << 8;
            for (let i = 0; i < 8; i++) {
                if (crc & 0x8000) {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc = crc << 1;
                }
            }
        }
        let hex = crc & 0xFFFF;
        hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);
        return hex;
    }

    async createDynamicQRIS(amount, staticQr) {
        try {
            let qrisData = staticQr;
            qrisData = qrisData.slice(0, -4);
            const step1 = qrisData.replace("010211", "010212");
            const step2 = step1.split("5802ID");
            const amountStr = amount.toString();
            let uang = "54" + ("0" + amountStr.length).slice(-2) + amountStr;
            uang += "5802ID";
            const result = step2[0] + uang + step2[1] + this.convertCRC16(step2[0] + uang + step2[1]);
            const qrCodeBuffer = await QRCode.toBuffer(result);
            return {
                qr_buffer: qrCodeBuffer,
                qr_string: result,
                amount: amount,
                created_at: new Date().toISOString()
            };
        } catch (error) {
            throw error;
        }
    }

    // OTP via telepon
    async requestOtp(phoneNumber) {
        const payload = {
            client_id: this.clientId,
            phone_number: phoneNumber,
            country_code: '62'
        };
        const response = await axios.post(`${this.baseUrl}/goid/login/request`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    // OTP via email
    async requestOtpEmail(email) {
        const payload = {
            email: email,
            client_id: this.clientId
        };
        const response = await axios.post(`${this.baseUrl}/goid/login/request`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async verifyOtp(otp, otpToken) {
        const payload = {
            client_id: this.clientId,
            data: {
                otp: otp,
                otp_token: otpToken
            },
            grant_type: 'otp'
        };
        const response = await axios.post(`${this.baseUrl}/goid/token`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async refreshToken(refreshToken) {
        const payload = {
            client_id: this.clientId,
            grant_type: 'refresh_token',
            data: {
                refresh_token: refreshToken
            }
        };
        const response = await axios.post(`${this.baseUrl}/goid/token`, payload, {
            headers: this.headers()
        });
        return response.data;
    }

    async getMe(accessToken) {
        const response = await axios.get(`${this.baseUrl}/v1/users/me`, {
            headers: this.headers(accessToken)
        });
        return response.data;
    }

    async getPayouts(accessToken) {
        const response = await axios.get(`${this.baseUrl}/v1/merchants/payouts?page=1&per=50`, {
            headers: this.headers(accessToken)
        });
        return response.data;
    }

    async getJournals(accessToken, merchantId, startTime = null) {
        const dateTo = new Date().toISOString();
        const dateFrom = startTime || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const payload = {
            from: 0,
            size: 50,
            sort: { time: { order: 'desc' } },
            included_categories: { incoming: ['transaction_share', 'action'] },
            query: [{
                clauses: [
                    { field: 'metadata.transaction.status', op: 'in', value: ['settlement', 'capture'] },
                    { field: 'metadata.transaction.transaction_time', op: 'gte', value: dateFrom },
                    { field: 'metadata.transaction.transaction_time', op: 'lte', value: dateTo },
                    { field: 'metadata.transaction.merchant_id', op: 'equal', value: merchantId }
                ],
                op: 'and'
            }]
        };
        const response = await axios.post(`${this.baseUrl}/journals/search`, payload, {
            headers: {
                ...this.headers(accessToken),
                'accept': 'application/vnd.journal.v1+json'
            }
        });
        return response.data;
    }
}

const app = express();
const sdk = new GoMerchant();

app.set('json spaces', 2);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ================= FUNGSI UPLOAD =================
async function toUrl(buffer, provider = "pixhost.to") {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Input harus buffer");
  }

  if (provider === "catbox") {
    const form = new FormData();
    form.append("fileToUpload", buffer, "file.png");
    form.append("reqtype", "fileupload");

    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
      headers: form.getHeaders()
    });

    const text = await res.text();
    if (!text.startsWith("http")) throw new Error("Catbox upload gagal");
    return text;
  }

  const service = new ImageUploadService(provider);
  let { directLink } = await service.uploadFromBinary(buffer, "skyzo.png");
  return directLink;
}

// ================= ROUTE HALAMAN =================
app.get('/', (req, res) => {
    res.render('index');
});

// ================= AUTH =================
// Kirim OTP (email atau telepon)
app.get('/auth/otp', async (req, res) => {
    try {
        const { email, phone } = req.query;

        // Jika email disediakan, gunakan email
        if (email) {
            const data = await sdk.requestOtpEmail(email);
            return res.json({
                success: true,
                data: {
                    otp_token: data.data.otp_token,
                    message: "Kode OTP Berhasil Dikirim ke Email"
                }
            });
        }

        // Fallback ke phone
        let phoneNumber = phone;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, error: 'email atau phone wajib diisi' });
        }
        if (phoneNumber.startsWith("62")) phoneNumber = phoneNumber.slice(2);

        const data = await sdk.requestOtp(phoneNumber);
        res.json({
            success: true,
            data: {
                otp_token: data.data.otp_token,
                message: "Kode OTP Berhasil Dikirim Via SMS"
            }
        });
    } catch (e) {
        res.status(400).json({ success: false, error: e.response?.data || e.message });
    }
});

// Verifikasi OTP (tetap /auth/verify)
app.get('/auth/verify', async (req, res) => {
    try {
        const { otp, otp_token } = req.query;
        if (!otp || !otp_token) return res.status(400).json({ success: false, error: 'otp dan otp_token wajib diisi' });
        const data = await sdk.verifyOtp(otp, otp_token);
        res.json({ success: true, data });
    } catch (e) {
        res.status(400).json({ success: false, error: e.response?.data || e.message });
    }
});

// Refresh token
app.get('/auth/refresh/token', async (req, res) => {
    try {
        const refreshToken = req.query.refresh_token;
        if (!refreshToken) return res.status(400).json({ success: false, error: 'refresh_token wajib diisi' });
        const data = await sdk.refreshToken(refreshToken);
        res.json({ success: true, data });
    } catch (e) {
        res.status(401).json({ success: false, error: e.response?.data || e.message });
    }
});

// Riwayat transaksi
app.get('/api/history', async (req, res) => {
    try {
        const token = req.query.token;
        if (!token) {
            return res.status(400).json({ success: false, error: 'token wajib diisi' });
        }
        const user = await sdk.getMe(token);
        const defaultStartTime = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
        const startTime = req.query.start_time || defaultStartTime;

        const result = await sdk.getJournals(token, user.user.merchant_id, startTime);
        const data = (result.hits || [])
            .filter(item => item?.metadata?.transaction?.payment_type === 'qris')
            .map(item => {
                const aspi = item.metadata?.provider_metadata?.aspi;
                return {
                    id: item.id,
                    reference_id: item.reference_id,
                    status: item.status,
                    time: item.time,
                    amount: aspi?.data?.amount || 0,
                    issuer: aspi?.issuer || null,
                    acquirer: aspi?.acquirer || null,
                    merchant_name: aspi?.data?.merchant_name || null,
                    merchant_id: aspi?.data?.merchant_id || null,
                    merchant_city: aspi?.data?.merchant_city || null,
                    terminal_label: aspi?.data?.additional_data?.terminal_label || null
                };
            });

        res.json({ success: true, total: data.length, data });
    } catch (e) {
        res.status(400).json({ success: false, error: e.response?.data || e.message });
    }
});

// QRIS Dinamis
app.get('/api/qris/create', async (req, res) => {
    try {
        const { amount, static_qr } = req.query;
        if (!amount || !static_qr) {
            return res.status(400).json({ success: false, error: 'Parameter amount dan static_qr wajib diisi' });
        }

        const data = await sdk.createDynamicQRIS(amount, static_qr);
        const qrBuffer = Buffer.isBuffer(data.qr_buffer)
            ? data.qr_buffer
            : Buffer.from(data.qr_buffer.data);

        const imageUrl = await toUrl(qrBuffer, "pixhost.to");

        res.json({
            success: true,
            image_url: imageUrl,
            amount: data.amount,
            qr_string: data.qr_string,
            created_at: data.created_at
        });
    } catch (e) {
        res.status(400).json({ success: false, error: e.response?.data || e.message });
    }
});

const PORT = process.env.PORT || 3015;
app.listen(PORT, () => console.log(`SANZ CLOUD PLATFORM listening on port ${PORT}`));