import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import Order from '../models/Order.js';


// Your merchant UPI ID where money will be received
const MERCHANT_UPI = 'mstandwafuelcentre@sbi';
const MERCHANT_SECRET = process.env.MERCHANT_SECRET || 'my_super_secret_key';

// Generate unique transaction ID (same as PHP uniqid)
const generateTransactionId = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `cw${timestamp}${random}`;
};

// Generate random note (same as PHP)
const generateNote = () => {
    return `s${Math.floor(Math.random() * 900) + 100}`;
};

// Create HMAC signature (same as PHP hash_hmac)
const createSignature = (payload) => {
    return crypto
        .createHmac('sha256', MERCHANT_SECRET)
        .update(payload)
        .digest('hex');
};

/**
 * @desc    Create payment transaction - Direct app opening
 * @route   POST /api/payment/create
 * @access  Public
 */
export const createPayment = async (req, res) => {
    try {
        const { amount, payType, orderId, userId } = req.body;

        // Validation
        if (!amount || !payType) {
            return res.status(400).json({
                error: 'Invalid payload'
            });
        }

        const paymentAmount = parseFloat(amount);
        const paymentType = payType.toLowerCase().trim();

        // Validate payment type
        if (!['phonepe', 'paytm'].includes(paymentType)) {
            return res.status(400).json({
                error: 'Unsupported payment type'
            });
        }

        // Generate transaction details (same as PHP)
        const tid = generateTransactionId();
        const expires = Math.floor(Date.now() / 1000) + 600; // 10 minutes in seconds
        const note = generateNote();

        let response;
        let payloadB64;
        let signature;
        let redirectUrl;

        if (paymentType === 'phonepe') {
            // ================= PHONEPE (Exact PHP logic) ==================
            const payloadJson = {
                contact: {
                    cbsName: "",
                    nickName: "",
                    vpa: MERCHANT_UPI, // Your UPI ID
                    type: "VPA"
                },
                p2pPaymentCheckoutParams: {
                    note: note,
                    isByDefaultKnownContact: true,
                    initialAmount: Math.floor(paymentAmount * 100), // Convert to paise
                    currency: "INR",
                    checkoutType: "DEFAULT",
                    transactionContext: "p2p"
                }
            };

            const payloadStr = JSON.stringify(payloadJson);
            payloadB64 = Buffer.from(payloadStr).toString('base64');
            signature = createSignature(payloadB64);
            const payloadUrlenc = encodeURIComponent(payloadB64);

            // PhonePe deep link - opens PhonePe app directly
            redirectUrl = `phonepe://native?data=${payloadUrlenc}&id=p2ppayment`;

            response = {
                redirect_url: redirectUrl,
                payload: payloadB64,
                sig: signature,
                expires: expires,
                tid: tid,
                amount: paymentAmount.toString()
            };

        } else if (paymentType === 'paytm') {
            // ================= PAYTM (Exact PHP logic) ==================
            const queryParams = new URLSearchParams({
                pa: MERCHANT_UPI, // Your UPI ID
                am: paymentAmount,
                tn: note,
                pn: MERCHANT_UPI,
                mc: '',
                cu: 'INR',
                url: '',
                mode: '',
                purpose: '',
                orgid: '',
                sign: '',
                featuretype: 'money_transfer'
            });

            // Paytm deep link - opens Paytm app directly
            redirectUrl = `paytmmp://cash_wallet?${queryParams.toString()}`;

            const payloadJson = {
                redirect: redirectUrl,
                tid: tid,
                exp: expires
            };

            const payloadStr = JSON.stringify(payloadJson);
            payloadB64 = Buffer.from(payloadStr).toString('base64');
            signature = createSignature(payloadB64);

            response = {
                redirect_url: redirectUrl,
                payload: payloadB64,
                sig: signature,
                expires: expires,
                tid: tid,
                amount: paymentAmount.toString()
            };
        }

        // Save transaction to database
        const transaction = new Transaction({
            tid: tid,
            userId: userId || null,
            orderId: orderId || null,
            amount: paymentAmount,
            payType: paymentType,
            upi: MERCHANT_UPI,
            status: 'pending',
            payload: payloadB64,
            signature: signature,
            redirectUrl: redirectUrl,
            note: note,
            expires: new Date(expires * 1000)
        });

        await transaction.save();

        // Return response (same format as PHP)
        res.status(200).json(response);

    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({
            error: 'Failed to create payment',
            message: error.message
        });
    }
};


/**
 * @desc    Check payment status
 * @route   GET /api/payment/status/:tid
 * @access  Public
 */
export const checkPaymentStatus = async (req, res) => {
    try {
        const { tid } = req.params;

        if (!tid) {
            return res.status(400).json({
                error: 'Transaction ID is required'
            });
        }

        const transaction = await Transaction.findOne({ tid });

        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Check if expired
        if (transaction.status === 'pending' && new Date() > transaction.expires) {
            transaction.status = 'expired';
            await transaction.save();
        }

        res.status(200).json({
            tid: transaction.tid,
            status: transaction.status,
            amount: transaction.amount,
            payType: transaction.payType,
            upi: transaction.upi,
            createdAt: transaction.createdAt,
            completedAt: transaction.completedAt
        });

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({
            error: 'Failed to check payment status',
            message: error.message
        });
    }
};

/**
 * @desc    Manually verify payment (after user confirms)
 * @route   POST /api/payment/verify
 * @access  Public
 */
export const verifyPayment = async (req, res) => {
    try {
        const { tid, status, signature } = req.body;

        if (!tid || !status) {
            return res.status(400).json({
                error: 'Transaction ID and status are required'
            });
        }

        const transaction = await Transaction.findOne({ tid });

        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }

        // Verify signature if provided
        if (signature) {
            const expectedSig = createSignature(transaction.payload);
            if (signature !== expectedSig) {
                return res.status(400).json({
                    error: 'Invalid signature'
                });
            }
        }

        // Check if already processed
        if (transaction.status !== 'pending') {
            return res.status(400).json({
                error: `Transaction already ${transaction.status}`
            });
        }

        // Update transaction status
        transaction.status = status;
        transaction.completedAt = new Date();
        await transaction.save();

        // Update order if exists
        if (transaction.orderId) {
            const order = await Order.findById(transaction.orderId);
            if (order) {
                if (status === 'success') {
                    order.paymentStatus = 'paid';
                    order.status = 'confirmed';
                } else if (status === 'failed') {
                    order.paymentStatus = 'failed';
                    order.status = 'cancelled';
                }
                await order.save();
            }
        }

        res.status(200).json({
            success: true,
            message: `Payment ${status}`,
            tid: transaction.tid,
            status: transaction.status,
            amount: transaction.amount
        });

    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({
            error: 'Failed to verify payment',
            message: error.message
        });
    }
};

/**
 * @desc    Get merchant UPI ID (for frontend)
 * @route   GET /api/payment/merchant-upi
 * @access  Public
 */
export const getMerchantUPI = async (req, res) => {
    try {
        res.status(200).json({
            upi: MERCHANT_UPI
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get merchant UPI'
        });
    }
};
