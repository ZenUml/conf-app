# PlantUML 验证优化 - 避免重复 API 调用

## 问题描述

在之前的实现中，当用户输入 PlantUML 语法错误时，会向 PlantUML API 发送**两次**验证请求：

1. **第一次**：`plantumlLinter`（CodeMirror linter）
   - 触发时机：用户在编辑器中输入/修改代码
   - 目的：在编辑器中显示语法错误（红色波浪线）

2. **第二次**：`PlantUml.vue` 组件的 `validateAndRender()`
   - 触发时机：编辑器代码变化 → Vuex store 更新 → watcher 触发
   - 目的：验证语法后决定是否渲染图表

这导致了不必要的网络请求和性能浪费。

## 解决方案

### 实现缓存机制

在 `src/utils/plantuml/validate.ts` 中添加了验证结果缓存：

```typescript
// Cache validation results to avoid duplicate API calls
const validationCache = new Map<string, { result: SyntaxValidationResult; timestamp: number }>();
const CACHE_TTL = 2000; // Cache for 2 seconds
```

### 工作原理

1. **缓存键**：使用完整的代码字符串作为缓存键
2. **缓存时效**：2秒 TTL（Time To Live）
3. **缓存检查**：每次验证前先检查缓存
4. **缓存更新**：所有验证结果（成功/失败/基础检查）都会被缓存

### 代码流程

```typescript
export async function validatePlantUmlSyntax(code: string): Promise<SyntaxValidationResult> {
  // 1. 检查缓存
  const cached = validationCache.get(code);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result; // 直接返回缓存结果，避免 API 调用
  }
  
  // 2. 基础验证（@startuml/@enduml）
  // ... 验证逻辑 ...
  
  // 3. PlantUML 服务器验证
  // ... API 调用 ...
  
  // 4. 缓存结果
  validationCache.set(code, { result, timestamp: Date.now() });
  return result;
}
```

## 效果

### 优化前
```
用户输入错误代码
  ↓
Linter 调用 validatePlantUmlSyntax() → API 请求 #1
  ↓
Store 更新触发 watcher
  ↓
PlantUml.vue 调用 validatePlantUmlSyntax() → API 请求 #2
```

### 优化后
```
用户输入错误代码
  ↓
Linter 调用 validatePlantUmlSyntax() → API 请求 #1 → 缓存结果
  ↓
Store 更新触发 watcher
  ↓
PlantUml.vue 调用 validatePlantUmlSyntax() → 从缓存返回（无 API 请求）
```

## 性能提升

- **减少 50% 的 API 请求**：每次代码变更只发送一次验证请求
- **更快的响应速度**：第二次验证直接从内存返回（<1ms）
- **降低服务器负载**：减少对 PlantUML 公共服务器的压力

## 缓存策略

### 为什么选择 2 秒 TTL？

1. **足够覆盖重复调用**：Linter 和组件的调用通常在几十毫秒内完成
2. **避免过期数据**：用户快速修改代码后，新代码会触发新的验证
3. **内存友好**：短 TTL 确保缓存不会无限增长

### 缓存失效场景

- 代码内容改变（缓存键不同）
- 超过 2 秒 TTL
- 页面刷新（内存缓存清空）

## 测试

单元测试文件：`src/utils/plantuml/validate.test.ts`

测试用例：
- ✅ 相同代码多次调用只发送一次 API 请求
- ✅ 错误结果也会被缓存
- ✅ 缓存在 TTL 后过期
- ✅ 基础验证错误不触发 API 调用

## 相关文件

- `src/utils/plantuml/validate.ts` - 验证逻辑和缓存实现
- `src/utils/plantuml/linter.ts` - CodeMirror linter
- `src/components/PlantUml.vue` - 渲染组件
- `src/utils/plantuml/validate.test.ts` - 单元测试

## 未来优化方向

1. **持久化缓存**：使用 IndexedDB 或 localStorage 跨会话缓存
2. **智能预验证**：在用户停止输入前不触发验证
3. **批量验证**：合并多个验证请求
4. **WebWorker**：将验证逻辑移到后台线程
