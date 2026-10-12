const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// التأكد من وجود المجلدات المطلوبة
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'documents.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

[UPLOADS_DIR, DATA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// معرفة عنوان الـ IP المحلي في الشبكة المحلية
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

function getSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        } catch (e) {}
    }
    return { customBaseUrl: '' };
}

function saveSettings(settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// تهيئة قاعدة البيانات المحلية (ملف JSON)
function getDocuments() {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function saveDocuments(docs) {
    fs.writeFileSync(DB_FILE, JSON.stringify(docs, null, 2), 'utf8');
}

// البيانات النموذجية لتصريح أجير
function getDefaultPermitData(customData = {}) {
    return {
        permitNumber: customData.permitNumber || 'TQ6262101',
        permitType: customData.permitType || 'تصريح تعاقد أجير',
        startDate: customData.startDate || '2026-10-12',
        endDate: customData.endDate || '2027-04-12',
        workerName: customData.workerName || 'RUIQIANG OU',
        idNumber: customData.idNumber || '2639295373',
        nationality: customData.nationality || 'الصين الشعبية',
        profession: customData.profession || 'عامل خرسانة',
        gender: customData.gender || 'ذكر',
        birthDate: customData.birthDate || '-',
        facilityNumber: customData.facilityNumber || '4-1665945',
        facilityName: customData.facilityName || 'مؤسسة أفق الصحاري للمقاولات عامة',
        beneficiaryFacilityName: customData.beneficiaryFacilityName || 'تشاينا بتروليم انجينيرينج أند كونستركشن كوربوريشن',
        beneficiaryFacilityNumber: customData.beneficiaryFacilityNumber || '15-1946336',
        contractSummary: customData.contractSummary || 'صيانة وتشغيل',
        workLocations: customData.workLocations || 'طريق الملك فهد، الحسام، الدمام 34223',
        status: customData.status || 'ساري / فعال'
    };
}

// إعداد التخزين باستخدام Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueSuffix = uuidv4();
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // حد أقصى 25 ميجابايت للملف
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|gif|pdf/;
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        const mime = file.mimetype;
        if (allowedTypes.test(ext) || allowedTypes.test(mime)) {
            return cb(null, true);
        }
        cb(new Error('الملفات المسموحة هي الصور (JPG, PNG, WEBP, GIF) أو ملفات PDF فقط'));
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// الحصول على رابط السيرفر الأساسي
function getBaseUrl(req) {
    const settings = getSettings();
    if (settings.customBaseUrl && settings.customBaseUrl.trim()) {
        return settings.customBaseUrl.trim().replace(/\/$/, '');
    }

    const host = req.get('host') || `localhost:${PORT}`;
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
        const localIp = getLocalIpAddress();
        return `http://${localIp}:${PORT}`;
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    return `${protocol}://${host}`;
}

// 0. API: إعدادات الرابط الأساسي
app.get('/api/settings', (req, res) => {
    const settings = getSettings();
    const effectiveBaseUrl = getBaseUrl(req);
    res.json({
        customBaseUrl: settings.customBaseUrl || '',
        effectiveBaseUrl,
        localIp: getLocalIpAddress(),
        port: PORT
    });
});

app.post('/api/settings', async (req, res) => {
    const { customBaseUrl } = req.body;
    saveSettings({ customBaseUrl: customBaseUrl ? customBaseUrl.trim() : '' });
    
    // تحديث روابط الـ QR للمستندات الحالية بالرابط الجديد
    const newBaseUrl = getBaseUrl(req);
    const docs = getDocuments();
    for (const doc of docs) {
        doc.viewUrl = `${newBaseUrl}/v/${doc.id}`;
        doc.qrCode = await QRCode.toDataURL(doc.viewUrl, {
            width: 400,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' }
        });
    }
    saveDocuments(docs);

    res.json({ success: true, effectiveBaseUrl: newBaseUrl });
});

// 1. API: جلب جميع المستندات
app.get('/api/documents', (req, res) => {
    const docs = getDocuments();
    docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(docs);
});

// 2. API: جلب مستند محدد بواسطة ID
app.get('/api/documents/:id', (req, res) => {
    const docs = getDocuments();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc) {
        return res.status(404).json({ error: 'المستند غير موجود' });
    }
    res.json(doc);
});

// 3. API: إنشاء تصريح أجير مباشرة ببيانات مخصصة (دون حاجة لرفع صورة)
app.post('/api/permits/create', async (req, res) => {
    try {
        const baseUrl = getBaseUrl(req);
        const docs = getDocuments();
        const id = uuidv4().substring(0, 8);
        const viewUrl = `${baseUrl}/v/${id}`;

        const permitData = getDefaultPermitData(req.body);
        const personName = permitData.workerName || req.body.personName || 'تصريح أجير';

        const qrCodeDataUrl = await QRCode.toDataURL(viewUrl, {
            width: 400,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' }
        });

        const newDoc = {
            id,
            personName,
            originalName: `تصريح_${permitData.permitNumber}.html`,
            fileName: '',
            fileUrl: '',
            fileType: 'permit',
            viewUrl,
            qrCode: qrCodeDataUrl,
            createdAt: new Date().toISOString(),
            permitData
        };

        docs.push(newDoc);
        saveDocuments(docs);

        res.json({ success: true, document: newDoc });
    } catch (error) {
        console.error('Error creating permit:', error);
        res.status(500).json({ error: error.message || 'حدث خطأ أثناء إنشاء التصريح' });
    }
});

// 4. API: تحديث بيانات تصريح أو مستند قائم
app.put('/api/documents/:id', (req, res) => {
    const docs = getDocuments();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc) {
        return res.status(404).json({ error: 'المستند غير موجود' });
    }

    if (req.body.personName) {
        doc.personName = req.body.personName.trim();
    }

    if (req.body.permitData) {
        doc.permitData = getDefaultPermitData({ ...(doc.permitData || {}), ...req.body.permitData });
        if (doc.permitData.workerName) {
            doc.personName = doc.permitData.workerName;
        }
    }

    saveDocuments(docs);
    res.json({ success: true, document: doc });
});

// 5. API: رفع صورة واحدة أو عدة صور
app.post('/api/upload', upload.array('files', 50), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'يرجى اختيار صورة واحدة على الأقل للرفع' });
        }

        const baseUrl = getBaseUrl(req);
        const docs = getDocuments();
        const uploadedDocs = [];

        let names = req.body.names;
        if (typeof names === 'string') {
            names = [names];
        } else if (!names) {
            names = [];
        }

        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const id = uuidv4().substring(0, 8);
            const personName = (names[i] && names[i].trim()) 
                ? names[i].trim() 
                : (req.body.defaultName && req.body.defaultName.trim()) 
                    ? `${req.body.defaultName.trim()} (${i + 1})`
                    : path.parse(file.originalname).name;

            const viewUrl = `${baseUrl}/v/${id}`;
            const qrCodeDataUrl = await QRCode.toDataURL(viewUrl, {
                width: 400,
                margin: 2,
                color: {
                    dark: '#0f172a',
                    light: '#ffffff'
                }
            });

            // إنشاء بيانات تصريح أجير مخصصة لهذا المستند
            const permitData = getDefaultPermitData({
                workerName: personName !== 'تصريح تجريبي' ? personName : 'RUIQIANG OU'
            });

            const newDoc = {
                id,
                personName,
                originalName: file.originalname,
                fileName: file.filename,
                fileUrl: `/uploads/${file.filename}`,
                fileType: file.mimetype.startsWith('image/') ? 'image' : 'pdf',
                viewUrl,
                qrCode: qrCodeDataUrl,
                createdAt: new Date().toISOString(),
                permitData
            };

            docs.push(newDoc);
            uploadedDocs.push(newDoc);
        }

        saveDocuments(docs);
        res.json({ success: true, count: uploadedDocs.length, documents: uploadedDocs });
    } catch (error) {
        console.error('Error during upload:', error);
        res.status(500).json({ error: error.message || 'حدث خطأ أثناء رفع الصور' });
    }
});

// 6. API: حذف مستند
app.delete('/api/documents/:id', (req, res) => {
    const docs = getDocuments();
    const index = docs.findIndex(d => d.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ error: 'المستند غير موجود' });
    }

    const [deletedDoc] = docs.splice(index, 1);
    saveDocuments(docs);

    if (deletedDoc.fileName) {
        const filePath = path.join(UPLOADS_DIR, deletedDoc.fileName);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error('Error deleting file:', e);
            }
        }
    }

    res.json({ success: true, message: 'تم الحذف بنجاح' });
});

// 7. صفحة الاستعراض للمستخدم عند مسح الـ QR أو فتح الرابط (دعم عدة مسارات مرنة)
const viewRoutes = ['/v/:id', '/p/:id', '/view/:id', '/uploads/pdf/:id'];
viewRoutes.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
    });
});

// 8. صفحة مستند وتصميم الـ PDF الرسمي للتصريح (مطابق لمستند وزارة الموارد البشرية وأجير)
const pdfRoutes = ['/pdf/:id', '/permit-pdf/:id', '/doc/:id'];
pdfRoutes.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'permit-document.html'));
    });
});

// تشغيل الخادم
app.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`🚀 خادم استعراض المستندات والـ QR يعمل الآن:`);
    console.log(`🔗 لوحة التحكم والرفع: http://localhost:${PORT}`);
    console.log(`===============================================`);
});
