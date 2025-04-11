const otpauth = require('otpauth');

const TOTP_SECRET = process.env.ATLASSIAN_OTP

if (!TOTP_SECRET) {
  throw new Error('ATLASSIAN_OTP is not set.')
}

const totp = new otpauth.TOTP({
  issuer: 'Atlassian',
  label: 'Atlassian',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: TOTP_SECRET
})


exports.generateOtp = () => totp.generate();