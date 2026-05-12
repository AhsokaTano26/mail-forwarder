import PostalMime from 'postal-mime';

export interface Env {
  MAIL_LIST: KVNamespace;
  ZEABUR_API_KEY: any; // 适配 Secrets Store 绑定
  FROM_EMAIL: string;
}

export default {
  async email(message: any, env: Env) {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] >>>>> 收到新邮件任务 <<<<<`);

    try {
      // 1. 邮件解析日志
      console.log(`[日志] 正在解析来自 ${message.from} 的原始邮件内容...`);
      const parser = new PostalMime();
      const parsed = await parser.parse(message.raw);

      const subject = parsed.subject || "无主题";
      const textBody = parsed.text || "（纯文本正文为空）";

      console.log(`[解析成功] 主题: "${subject}"`);
      console.log(`[解析成功] 正文长度: ${textBody.length} 字符`);

      // 2. 密钥获取日志
      console.log(`[配置] 正在从 Secrets Store 获取 API 密钥...`);
      let apiKey: string;
      if (env.ZEABUR_API_KEY && typeof env.ZEABUR_API_KEY.get === 'function') {
        apiKey = await env.ZEABUR_API_KEY.get(); //
        console.log(`[配置] 密钥读取成功 (Secrets Store 模式)`);
      } else {
        apiKey = env.ZEABUR_API_KEY;
        console.log(`[配置] 密钥读取成功 (环境变量模式)`);
      }

      // 3. 目标地址日志
      console.log(`[KV] 正在从存储读取转发名单...`);
      const kvData = await env.MAIL_LIST.get("emails");
      const targetEmails: string[] = JSON.parse(kvData || "[]");

      if (targetEmails.length === 0) {
        console.warn(`[中断] KV 名单为空，跳过转发。`);
        return;
      }
      console.log(`[KV] 准备转发至以下地址: ${targetEmails.join(", ")}`);

      // 4. API 请求日志
      const payload = {
        emails: targetEmails.map(to => ({
          from: env.FROM_EMAIL,
          to: [to],
          subject: subject,
          text: textBody
        }))
      };

      console.log(`[API] 正在向 Zeabur 发送请求... 发件人: ${env.FROM_EMAIL}`);

      const startTime = Date.now();
      const response = await fetch("https://api.zeabur.com/api/v1/zsend/emails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      const duration = Date.now() - startTime;

      // 5. 结果反馈日志
      const result = await response.text();
      console.log(`[API响应] 状态码: ${response.status} (耗时: ${duration}ms)`);
      console.log(`[API响应] 详细结果: ${result}`);

      if (!response.ok) {
        if (response.status === 400) {
          console.error(`[失败] 请求无效。请确认 env.FROM_EMAIL (${env.FROM_EMAIL}) 已在 Zeabur 后台完成域名验证。`);
        } else if (response.status === 401) {
          console.error(`[失败] 认证失败。请检查 ZEABUR_API_KEY 是否正确。`);
        }
      } else {
        console.log(`[成功] 邮件转发流程全部完成。`);
      }

    } catch (err: any) {
      console.error(`[异常] 捕获到未处理的错误:`);
      console.error(`> 错误信息: ${err.message}`);
      console.error(`> 错误堆栈: ${err.stack || "无堆栈信息"}`);
    } finally {
      console.log(`[${timestamp}] <<<<< 任务处理结束 >>>>>\n`);
    }
  }
};