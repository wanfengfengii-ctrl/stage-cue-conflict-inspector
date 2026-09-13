import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 两类测试分开投影（不显式 extends vite.config.ts，以免 test.include 数组被合并，
 * 导致 .ts 用例在两个 project 下重复运行）：
 * - core：纯领域逻辑（.test.ts），node 环境，无 DOM；
 * - dom：React 交互测试（.test.tsx），jsdom 环境，
 *   验证聚焦期间的选择轮换、失效退焦、编辑清除聚焦等装配行为。
 */
export default defineWorkspace([
  {
    plugins: [react()],
    test: {
      name: 'core',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'dom',
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
    },
  },
]);
