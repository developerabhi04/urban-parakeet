import express from 'express';
import { checkPaymentStatus, createPayment, getMerchantUPI, verifyPayment } from '../controllers/paymentController.js';



const router = express.Router();


router.post('/create', createPayment);
router.get('/status/:tid', checkPaymentStatus);
router.post('/verify', verifyPayment);
router.get('/merchant-upi', getMerchantUPI);



export default router;
