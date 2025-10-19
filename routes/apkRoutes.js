import express from 'express';
import multer from 'multer';
import {
    uploadApk,
    getApkStatus,
    downloadApk
} from '../controllers/apkController.js';
import { adminAuth } from '../middleware/auth.js';

const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB
const router = express.Router();

router.get('/status', getApkStatus);                       // public
router.get('/download', downloadApk);                        // public
router.post('/upload', adminAuth, upload.single('apk'), uploadApk); // admin

export default router;
