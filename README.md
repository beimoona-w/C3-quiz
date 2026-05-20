# C3 安全考试刷题 App — 部署指南

## 项目结构

```
quiz-app/
├── public/
│   ├── questions.json   ← 2965 道题库
│   ├── manifest.json    ← PWA 配置
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── App.jsx          ← 主应用
│   ├── db.js            ← CloudBase 同步
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

---

## 第一步：CloudBase 配置（已帮你填好环境 ID）

在腾讯云 CloudBase 控制台完成以下操作：

1. 进入 **文档型数据库**
2. 新建集合，名称填 `quiz_progress`
3. 点进集合 → **权限设置** → 改为「所有用户可读写」
4. 左侧菜单 → **身份认证** → 开启「匿名登录」

---

## 第二步：上传到 GitHub

```bash
# 在本地解压项目后
cd quiz-app
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/c3-quiz.git
git push -u origin main
```

---

## 第三步：Vercel 部署

1. 登录 [vercel.com](https://vercel.com)
2. 点 **Add New Project** → 选择刚才的 GitHub 仓库
3. Framework 选 **Vite**（会自动识别）
4. 直接点 **Deploy**，等待 1-2 分钟

---

## 第四步：绑定你的域名（子路径方式）

因为你选的是 `yourdomain.com/quiz` 子路径方式：

在你**已有的 Vercel 项目**（主网站）里配置 Rewrite：

打开主网站的 `vercel.json`，添加：
```json
{
  "rewrites": [
    { "source": "/quiz/:path*", "destination": "https://c3-quiz.vercel.app/:path*" }
  ]
}
```
把 `c3-quiz.vercel.app` 替换成你新部署项目的实际域名。

---

## 手机安装到桌面（PWA）

**iPhone Safari：**
打开网址 → 底部分享按钮 → 添加到主屏幕

**Android Chrome：**
打开网址 → 右上角菜单 → 添加到主屏幕

---

## 跨设备同步说明

- 每台设备首次使用会自动生成一个**同步码**（6位字母数字）
- 在主页底部可以看到你的同步码
- 换设备时：点右上角 🔄 → 输入原设备的同步码 → 进度自动同步
- **请记住你的同步码！**

---

## 本地开发

```bash
npm install
npm run dev
# 访问 http://localhost:5173
```
