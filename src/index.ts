import PostalMime from 'postal-mime';

export default {
  async email(message: any, env: any) {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`[${timestamp}] >>> 开始邮件转发 <<<`);

    try {
      // 1. 基础解析
      const parser = new PostalMime();
      const parsed = await parser.parse(message.raw);

      const subject = parsed.subject || "无主题";
      const fromName = parsed.from.name || "";
      const fromAddr = parsed.from.address || "未知地址";
      const originalSender = `${fromName} <${fromAddr}>`;

      console.log(`[日志] 收到来自 ${originalSender} 的邮件`);

      // 2. 注入原始发件人信息到正文顶部 (展示最原始的发件)
      const headerHtml = `
        <div style="background: #f4f4f4; border-left: 4px solid #ccc; padding: 10px; margin-bottom: 20px; color: #666; font-size: 14px;">
          <strong>原始发件人:</strong> ${originalSender}<br>
          <strong>发送时间:</strong> ${parsed.date || timestamp}<br>
          <strong>转发来源:</strong> ${message.to}
        </div>
        <hr>
      `;

      const finalHtml = parsed.html ? (headerHtml + parsed.html) : "";
      const finalLines = [`原始发件人: ${originalSender}`, `发送时间: ${parsed.date || timestamp}`, "---", ""];
      const finalText = (parsed.text ? (finalLines.join('\n') + parsed.text) : "");

      // 3. 安全处理附件 (有就发，没有就不发)
      let attachments: any[] = [];
      if (parsed.attachments && parsed.attachments.length > 0) {
        console.log(`[日志] 检测到 ${parsed.attachments.length} 个附件，准备转换...`);
        attachments = parsed.attachments.map(att => {
          try {
            const base64Content = btoa(
              new Uint8Array(att.content).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            return {
              filename: att.filename || "未命名文件",
              content: base64Content,
              contentType: att.mimeType || "application/octet-stream",
              disposition: att.disposition || 'attachment'
            };
          } catch (e) {
            console.error(`[警告] 附件 ${att.filename} 转换失败:`, e);
            return null;
          }
        }).filter(item => item !== null); // 过滤掉转换失败的
      } else {
        console.log(`[日志] 此邮件无附件`);
      }

      // 4. 获取配置与转发列表
      const apiKey = await env.ZEABUR_API_KEY.get();
      const kvData = await env.MAIL_LIST.get("emails");
      const targets: string[] = JSON.parse(kvData || "[]");

      console.log(`[KV] 准备转发至以下地址: ${targets.join(", ")}`);

      if (targets.length === 0) {
        console.error("[错误] 未配置转发名单 (MAIL_LIST)");
        return;
      }

      // 5. 构造 Payload (动态构建，确保有值才发)
      const payload = {
        emails: targets.map(to => {
          const emailObj: any = {
            from: env.FROM_EMAIL,
            to: [to],
            subject: `[转发] ${subject}`
          };

          // 动态注入内容：有就发，没有就不发
          if (finalHtml) emailObj.html = finalHtml;
          if (finalText) emailObj.text = finalText;
          if (attachments.length > 0) emailObj.attachments = attachments;

          return emailObj;
        })
      };

      // 6. 发送请求并记录完整日志
      console.log(`[API] 正在推送至 Zeabur... 目标人数: ${targets.length}`);
      const response = await fetch("https://api.zeabur.com/api/v1/zsend/emails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      if (response.ok) {
        console.log(`[成功] API响应: ${response.status} - 邮件已投递`);
      } else {
        console.error(`[失败] API响应: ${response.status} - 详情: ${responseText}`);
      }

    } catch (err: any) {
      console.error(`[崩溃日志] 发生未知错误: ${err.stack || err.message}`);
    }

    console.log(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] <<<< 任务结束 >>>>`);
  }
};