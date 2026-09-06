/**
 * 書き出し完了(または失敗)をメールで知らせる機能。
 *
 * Python版はGmailのSMTP(アプリパスワード)を直接使っていたが、このWeb版はサーバーを
 * 持たない静的サイトのため、ブラウザから直接メール送信できる外部サービス「EmailJS」
 * (https://www.emailjs.com/)を使う。ユーザー自身がEmailJSに登録し、メール送信サービス
 * (Gmail等)とテンプレートを設定した上で、発行されるService ID/Template ID/Public Key を
 * このアプリの設定画面(NotifySettingsModal)に入力してもらう(Python版のGmailアプリ
 * パスワードと同じ方針: 値はこのブラウザのlocalStorageにのみ保存し、Claudeやこの
 * アプリの開発元には一切送信されない)。
 */

export interface NotifySettings {
  enabled: boolean;
  serviceId: string;
  templateId: string;
  publicKey: string;
  toEmail: string;
}

const STORAGE_KEY = 'daily-clips-notify-settings';

const DEFAULT_SETTINGS: NotifySettings = {
  enabled: false,
  serviceId: '',
  templateId: '',
  publicKey: '',
  toEmail: '',
};

export function getNotifySettings(): NotifySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveNotifySettings(settings: NotifySettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 通知メールを送信する。失敗時はエラーメッセージを返す(成功時はnull)。
 * 通知の送信失敗が書き出し処理自体を失敗扱いにすることは無いよう、呼び出し元は
 * このエラーをconsole.error等に留め、書き出し結果の成否とは独立に扱うこと。
 *
 * EmailJSのテンプレート側では、次の3つの変数を使えるようにしておく必要がある:
 * {{to_email}}(宛先) / {{subject}}(件名) / {{message}}(本文)
 */
export async function sendCompletionEmail(subject: string, message: string): Promise<string | null> {
  const settings = getNotifySettings();
  if (!settings.enabled) return null;
  if (!settings.serviceId || !settings.templateId || !settings.publicKey || !settings.toEmail) {
    return 'メール通知の設定(Service ID/Template ID/Public Key/通知先)が不完全です';
  }
  try {
    const emailjs = (await import('@emailjs/browser')).default;
    await emailjs.send(
      settings.serviceId,
      settings.templateId,
      { to_email: settings.toEmail, subject, message },
      { publicKey: settings.publicKey },
    );
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
