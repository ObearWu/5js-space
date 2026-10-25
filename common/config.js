// 全站共用設定。正式網址與 Google OAuth Client ID 只寫在這裡。
// 本機開發（localhost / 127.0.0.1）自動改連本機後端。
window.FIVEJS_CONFIG = {
  API_BASE: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://127.0.0.1:5001"
    : "https://fivejs-space-backend.onrender.com",
  // Google Cloud 專案 5js-space 的 OAuth 用戶端（跟後端 GOOGLE_CLIENT_ID 同一組）
  GOOGLE_CLIENT_ID: "734030888137-4806og41rmasu7hc2gseponrtgedd5ug.apps.googleusercontent.com",
};
