import crypto from 'crypto';
import axios from 'axios';
import { DatabaseService } from './DatabaseService';

const LEMON_SQUEEZY_API = 'https://api.lemonsqueezy.com/v1';

/** Checkout variant keys mapped to environment variable names. */
export type CheckoutVariant =
    | 'personal_annual'
    | 'personal_lifetime'
    | 'team_monthly'
    | 'team_annual'
    | 'team_lifetime';

const VARIANT_ENV_MAP: Record<CheckoutVariant, string> = {
    personal_annual: 'LEMONSQUEEZY_VARIANT_ID_PERSONAL_ANNUAL',
    personal_lifetime: 'LEMONSQUEEZY_VARIANT_ID_PERSONAL_LIFETIME',
    team_monthly: 'LEMONSQUEEZY_VARIANT_ID_TEAM_MONTHLY',
    team_annual: 'LEMONSQUEEZY_VARIANT_ID_TEAM_ANNUAL',
    team_lifetime: 'LEMONSQUEEZY_VARIANT_ID_TEAM_LIFETIME',
};

/** Subset of Lemon Squeezy subscription statuses we care about. */
type SubscriptionStatus =
    | 'on_trial'
    | 'active'
    | 'paused'
    | 'past_due'
    | 'unpaid'
    | 'cancelled'
    | 'expired';

/** Parsed webhook payload (JSON:API envelope). */
export interface WebhookPayload {
    meta: {
        event_name: string;
        custom_data?: Record<string, string>;
    };
    data: {
        id: string;
        type: string;
        attributes: Record<string, unknown>;
    };
}

export class LemonSqueezyService {
    private static instance: LemonSqueezyService;
    private constructor() {}

    public static getInstance(): LemonSqueezyService {
        if (!LemonSqueezyService.instance) {
            LemonSqueezyService.instance = new LemonSqueezyService();
        }
        return LemonSqueezyService.instance;
    }

    // ─── Config helpers ───────────────────────────────────────────────

    private getApiKey(): string {
        const key = process.env.LEMONSQUEEZY_API_KEY;
        if (!key) throw new Error('LEMONSQUEEZY_API_KEY is not configured');
        return key;
    }

    private getStoreId(): string {
        const id = process.env.LEMONSQUEEZY_STORE_ID;
        if (!id) throw new Error('LEMONSQUEEZY_STORE_ID is not configured');
        return id;
    }

    private getWebhookSecret(): string {
        const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        if (!secret) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET is not configured');
        return secret;
    }

    public getVariantId(variant: CheckoutVariant): string | null {
        const envName = VARIANT_ENV_MAP[variant];
        return process.env[envName] || null;
    }

    /** Returns true when the minimum env vars for checkout/webhook are set. */
    public isConfigured(): boolean {
        return !!(process.env.LEMONSQUEEZY_API_KEY && process.env.LEMONSQUEEZY_STORE_ID);
    }

    // ─── Checkout ─────────────────────────────────────────────────────

    /**
     * Create a Lemon Squeezy checkout and return the hosted URL.
     */
    public async createCheckout(
        variant: CheckoutVariant,
        email?: string,
    ): Promise<{ url: string }> {
        const variantId = this.getVariantId(variant);
        if (!variantId) {
            throw new Error(`Variant "${variant}" is not configured (missing env var ${VARIANT_ENV_MAP[variant]})`);
        }

        const db = DatabaseService.getInstance();
        const instanceId = db.getSystemState('instance_id') || '';

        const checkoutData: Record<string, unknown> = {
            custom: { instance_id: instanceId },
        };
        if (email) {
            checkoutData.email = email;
        }

        const response = await axios.post(
            `${LEMON_SQUEEZY_API}/checkouts`,
            {
                data: {
                    type: 'checkouts',
                    attributes: {
                        checkout_data: checkoutData,
                        checkout_options: { dark: true },
                    },
                    relationships: {
                        store: { data: { type: 'stores', id: this.getStoreId() } },
                        variant: { data: { type: 'variants', id: variantId } },
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${this.getApiKey()}`,
                    'Content-Type': 'application/vnd.api+json',
                    Accept: 'application/vnd.api+json',
                },
                timeout: 15000,
            },
        );

        const url = response.data?.data?.attributes?.url;
        if (!url) throw new Error('Lemon Squeezy did not return a checkout URL');
        return { url };
    }

    // ─── Webhook verification ─────────────────────────────────────────

    /**
     * Verify the HMAC-SHA256 signature on an incoming webhook.
     */
    public verifySignature(rawBody: Buffer, signature: string): boolean {
        try {
            const secret = this.getWebhookSecret();
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(rawBody);
            const digest = hmac.digest('hex');
            return crypto.timingSafeEqual(
                Buffer.from(digest, 'hex'),
                Buffer.from(signature, 'hex'),
            );
        } catch {
            return false;
        }
    }

    // ─── Webhook event processing ─────────────────────────────────────

    /**
     * Process a verified webhook event and update license state accordingly.
     */
    public processWebhookEvent(payload: WebhookPayload): void {
        const { event_name, custom_data } = payload.meta;
        const attrs = payload.data.attributes;
        const resourceId = payload.data.id;
        const db = DatabaseService.getInstance();

        // Only process events for this instance (if custom_data was set during checkout)
        const instanceId = db.getSystemState('instance_id');
        if (custom_data?.instance_id && custom_data.instance_id !== instanceId) {
            console.log(`[Webhook] Ignoring event for different instance: ${custom_data.instance_id}`);
            return;
        }

        console.log(`[Webhook] Processing event: ${event_name} (resource ${payload.data.type}#${resourceId})`);

        switch (event_name) {
            case 'order_created':
                this.handleOrderCreated(attrs, db);
                break;
            case 'order_refunded':
                this.handleOrderRefunded(db);
                break;
            case 'subscription_created':
            case 'subscription_resumed':
            case 'subscription_unpaused':
                this.handleSubscriptionActive(attrs, resourceId, db);
                break;
            case 'subscription_updated':
                this.handleSubscriptionUpdated(attrs, resourceId, db);
                break;
            case 'subscription_cancelled':
                this.handleSubscriptionCancelled(attrs, db);
                break;
            case 'subscription_expired':
                this.handleSubscriptionExpired(db);
                break;
            case 'subscription_paused':
                this.handleSubscriptionPaused(db);
                break;
            case 'subscription_payment_failed':
                console.warn('[Webhook] Subscription payment failed. License remains active during grace period.');
                break;
            case 'subscription_payment_success':
            case 'subscription_payment_recovered':
                this.handlePaymentSuccess(attrs, db);
                break;
            case 'subscription_payment_refunded':
                console.log('[Webhook] Subscription payment refunded.');
                break;
            case 'license_key_created':
            case 'license_key_updated':
                this.handleLicenseKey(attrs, db);
                break;
            default:
                console.log(`[Webhook] Unhandled event: ${event_name}`);
        }
    }

    // ─── Event handlers (private) ─────────────────────────────────────

    /** One-time purchase (lifetime deal) — activate immediately. */
    private handleOrderCreated(attrs: Record<string, unknown>, db: DatabaseService): void {
        const status = attrs.status as string;
        if (status !== 'paid') {
            console.log(`[Webhook] Order status is "${status}", skipping activation.`);
            return;
        }

        db.setSystemState('license_status', 'active');
        db.setSystemState('license_valid_until', ''); // lifetime — no expiry
        db.setSystemState('license_last_validated', Date.now().toString());

        const orderItem = attrs.first_order_item as Record<string, unknown> | undefined;
        if (orderItem) {
            if (orderItem.product_name) db.setSystemState('license_product_name', orderItem.product_name as string);
            if (orderItem.variant_name) db.setSystemState('license_variant_name', orderItem.variant_name as string);
        }

        const customerId = attrs.customer_id;
        if (customerId) db.setSystemState('customer_id', String(customerId));

        const orderId = attrs.identifier ?? attrs.id;
        if (orderId) db.setSystemState('order_id', String(orderId));

        // Store receipt URL
        const urls = attrs.urls as Record<string, string> | undefined;
        if (urls?.receipt) db.setSystemState('receipt_url', urls.receipt);

        console.log('[Webhook] Order activated (one-time purchase).');
    }

    /** Order refunded — revoke license. */
    private handleOrderRefunded(db: DatabaseService): void {
        db.setSystemState('license_status', 'expired');
        db.setSystemState('customer_portal_url', '');
        console.log('[Webhook] Order refunded. License revoked.');
    }

    /** Subscription activated / resumed / unpaused. */
    private handleSubscriptionActive(attrs: Record<string, unknown>, subscriptionId: string, db: DatabaseService): void {
        db.setSystemState('license_status', 'active');
        db.setSystemState('license_last_validated', Date.now().toString());
        db.setSystemState('subscription_id', subscriptionId);

        this.storeSubscriptionMetadata(attrs, db);
        console.log('[Webhook] Subscription activated.');
    }

    /** Subscription updated — could be plan change, renewal date change, etc. */
    private handleSubscriptionUpdated(attrs: Record<string, unknown>, subscriptionId: string, db: DatabaseService): void {
        const status = attrs.status as SubscriptionStatus | undefined;
        db.setSystemState('subscription_id', subscriptionId);
        db.setSystemState('license_last_validated', Date.now().toString());

        // Map LS subscription status to our license status
        if (status === 'active' || status === 'on_trial' || status === 'past_due') {
            db.setSystemState('license_status', status === 'on_trial' ? 'trial' : 'active');
        } else if (status === 'cancelled') {
            // Cancelled but still active until end of period
            const endsAt = attrs.ends_at as string | null;
            if (endsAt && new Date(endsAt) > new Date()) {
                db.setSystemState('license_status', 'active');
                db.setSystemState('license_valid_until', endsAt);
            } else {
                db.setSystemState('license_status', 'expired');
            }
        } else if (status === 'expired' || status === 'unpaid') {
            db.setSystemState('license_status', 'expired');
        } else if (status === 'paused') {
            db.setSystemState('license_status', 'disabled');
        }

        this.storeSubscriptionMetadata(attrs, db);
        console.log(`[Webhook] Subscription updated (status: ${status}).`);
    }

    /** Subscription cancelled — still active until end of billing period. */
    private handleSubscriptionCancelled(attrs: Record<string, unknown>, db: DatabaseService): void {
        const endsAt = attrs.ends_at as string | null;
        if (endsAt) {
            db.setSystemState('license_valid_until', endsAt);
            if (new Date(endsAt) > new Date()) {
                db.setSystemState('license_status', 'active');
                console.log(`[Webhook] Subscription cancelled. Active until ${endsAt}.`);
            } else {
                db.setSystemState('license_status', 'expired');
                console.log('[Webhook] Subscription cancelled and expired.');
            }
        } else {
            db.setSystemState('license_status', 'expired');
            console.log('[Webhook] Subscription cancelled.');
        }
    }

    /** Subscription expired. */
    private handleSubscriptionExpired(db: DatabaseService): void {
        db.setSystemState('license_status', 'expired');
        console.log('[Webhook] Subscription expired.');
    }

    /** Subscription paused. */
    private handleSubscriptionPaused(db: DatabaseService): void {
        db.setSystemState('license_status', 'disabled');
        console.log('[Webhook] Subscription paused.');
    }

    /** Successful payment (renewal or recovery). */
    private handlePaymentSuccess(attrs: Record<string, unknown>, db: DatabaseService): void {
        db.setSystemState('license_status', 'active');
        db.setSystemState('license_last_validated', Date.now().toString());

        const renewsAt = attrs.renews_at as string | null;
        if (renewsAt) db.setSystemState('license_valid_until', renewsAt);

        console.log('[Webhook] Payment successful.');
    }

    /** License key created or updated — store for manual activation compatibility. */
    private handleLicenseKey(attrs: Record<string, unknown>, db: DatabaseService): void {
        const key = attrs.key as string | undefined;
        if (key) {
            db.setSystemState('license_key', key);
            console.log('[Webhook] License key stored.');
        }
    }

    /** Extract and store common subscription metadata. */
    private storeSubscriptionMetadata(attrs: Record<string, unknown>, db: DatabaseService): void {
        const productName = attrs.product_name as string | undefined;
        const variantName = attrs.variant_name as string | undefined;
        const customerName = attrs.user_name as string | undefined;
        const customerId = attrs.customer_id;
        const renewsAt = attrs.renews_at as string | null;
        const endsAt = attrs.ends_at as string | null;

        if (productName) db.setSystemState('license_product_name', productName);
        if (variantName) db.setSystemState('license_variant_name', variantName);
        if (customerName) db.setSystemState('license_customer_name', customerName);
        if (customerId) db.setSystemState('customer_id', String(customerId));

        // For active subscriptions, valid_until = renews_at (next billing date)
        if (renewsAt) {
            db.setSystemState('license_valid_until', renewsAt);
        } else if (endsAt) {
            db.setSystemState('license_valid_until', endsAt);
        }

        // Store customer portal URL for billing management
        const urls = attrs.urls as Record<string, string> | undefined;
        if (urls?.customer_portal) {
            db.setSystemState('customer_portal_url', urls.customer_portal);
        }
        if (urls?.update_payment_method) {
            db.setSystemState('update_payment_url', urls.update_payment_method);
        }
    }
}
