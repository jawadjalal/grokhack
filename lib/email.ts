// Sends one pitch through Resend. Nothing is sent unless a person types the
// address and presses Send in the drawer.
// RESEND_FROM must be on a domain verified in Resend. Without one, Resend's
// onboarding@resend.dev sender only delivers to the Resend account's own email.
export async function sendPitch({ to, subject, body, replyTo }: { to: string; subject: string; body: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("Email isn't connected yet: add RESEND_API_KEY")
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('That email address looks wrong')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? 'Backer <onboarding@resend.dev>',
      to: [to],
      subject,
      text: body,
      reply_to: replyTo ?? process.env.RESEND_REPLY_TO,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Resend ${res.status}`)
  return data.id as string
}
