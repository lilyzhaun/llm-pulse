# Biome 规则禁用说明

本文件记录 `biome.json` 中当前关闭的规则，以及它们在本代码库里的具体背景。这里不代表这些规则长期不需要，只说明现在直接开启会产生哪些误报或需要配套重构。

## `correctness.useExhaustiveDependencies`

当前前端有多处 effect 依赖浏览器 API、清理函数和局部回调，例如 `apps/frontend/src/App.tsx` 中监听系统主题变化、写入 `localStorage`，以及 `apps/frontend/src/pages/Dashboard.tsx` 中用 `AbortController` 拉取 Snapshot。现在这些 effect 的依赖已经按实际触发条件收窄，直接开启该规则容易要求把只在 effect 内部创建的对象或回调纳入依赖，从而改变请求、监听器或节流定时器的生命周期。

当这些副作用被拆成更小的自定义 hook，并能逐个验证请求取消、主题切换和节流刷新行为时，值得重新评估。

## `style.noNonNullAssertion`

`apps/frontend/src/main.tsx` 使用 `document.getElementById("root")!` 挂载 React 应用。当前 `index.html` 提供固定的 `root` 节点，这是应用启动的硬性前提；如果节点不存在，启动失败比继续渲染到空目标更容易暴露部署问题。

当入口改成显式运行时校验并输出清晰错误，或测试覆盖缺失根节点场景时，值得重新评估。

## `suspicious.noArrayIndexKey`

`apps/frontend/src/components/ModelPulseCard.tsx` 会为心跳图补齐前导空槽，空槽没有业务 ID，只表示固定时间窗口中的占位位置，因此使用 `key={`empty-${index}`}`。真实心跳数据仍使用 `beat.start` 作为 key，避免和占位槽混用。

当空槽也有稳定的时间戳或窗口起点可以作为身份时，值得重新评估。

## `suspicious.noEmptyInterface`

当前代码库没有空接口用例，但规则保持关闭是为了兼容共享类型和外部类型扩展的写法。项目最近已清理 `apps/server/src/types/local.d.ts` 中的历史声明噪音，暂时不把这条规则作为阻断项，可以避免在类型边界调整时引入和功能无关的 lint 变更。

当共享类型和本地声明文件稳定，并确认没有需要通过空接口表达扩展点的场景时，值得重新评估。

## `style.noUnusedTemplateLiteral`

前端会把数字写入 CSS custom properties，例如 `apps/frontend/src/components/ModelPulseCard.tsx` 中的 `"--beat-count": `${heartbeatSlotCount}`` 和 `"--beat-intensity": `${beat.totalCount / maxBeatCount}``。这些值最后交给样式层消费，模板字符串能保持和其他带单位的 CSS 值写法一致。

当 CSS 变量赋值统一改成 `String(value)` 或集中封装到样式工具函数后，值得重新评估。

## `a11y.useKeyWithClickEvents`

`apps/frontend/src/components/ModelPulseCard.tsx` 的卡片 header 使用 `onClick` 展开卡片，同时已经提供 `role="button"`、`tabIndex={0}` 和 `onKeyDown` 处理 Enter、Space。该交互绑定在 card header 上，而不是原生 `button`，是为了让整个标题区域保持卡片式点击目标。

当展开交互可以改成原生 `button`，并且不会破坏当前卡片布局和冒泡处理时，值得重新评估。

## `a11y.useSemanticElements`

同一处 `ModelPulseCard` header 使用 `role="button"` 表达可点击区域。当前结构里 header 既承担语义分组，又承担展开控制；直接替换为 `button` 需要同步调整嵌套标题、状态徽标和样式，不能只做机械替换。

当卡片 header 拆出专用展开按钮，或完成语义结构重排并通过键盘访问验证时，值得重新评估。
