import { useState } from 'react';
import { checkBackend } from './api/health';
import styles from './App.module.css';

export function App() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('尚未检查后端连接。');
  const [failed, setFailed] = useState(false);

  async function handleCheck() {
    setChecking(true);
    setFailed(false);
    setMessage('正在检查后端连接…');

    try {
      await checkBackend();
      setMessage('连接正常，前端已通过 /api 访问独立的 Fastify 服务。');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '连接失败，请检查后端服务。');
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.identity}>ATOMS / DEMO</span>
        <span>工程初始化</span>
      </header>
      <h1>从一个可运行的起点开始。</h1>
      <p className={styles.intro}>
        React 前端与 Fastify 后端已分别建立。当前页面用于验证工程和服务连接，应用生成功能将在后续实现。
      </p>
      <section className={styles.panel} aria-labelledby="connection-title">
        <h2 id="connection-title">服务连接</h2>
        <p>通过 <code>GET /api/health</code> 检查后端。</p>
        <button type="button" onClick={handleCheck} disabled={checking}>
          {checking ? '检查中…' : '检查后端连接'}
        </button>
        <p aria-live="polite" className={failed ? styles.error : styles.status}>
          {message}
        </p>
      </section>
    </main>
  );
}
