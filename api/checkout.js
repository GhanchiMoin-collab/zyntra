export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', 'price_1TzcRMJLKJy3e4gzG9PJmi5V');
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${origin}/?payment=success`);
    params.append('cancel_url', `${origin}/?payment=cancelled`);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Stripe error' });
    }

    return res.status(200).json({ url: data.url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
