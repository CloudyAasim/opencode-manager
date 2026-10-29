/**
 * 字段的那张脸。
 *
 * 输入框、下拉框、多行框是同一个零件的三张脸：它们挨着放在同一行里，读起来
 * 应该是同一句话。而这张脸（圆角、边框、背景、阴影）原来各写各的——
 * 输入框是 `rounded-lg` / `bg-card` / `shadow-xs`，下拉框和多行框是
 * `rounded-md` / `bg-background` / 没有阴影。
 *
 * 于是**脸只写一处**：三个零件都从这一处拿，谁也不许自己再画一张。
 *
 * 这里**不包括里面留多少空当**（内边距）：那是 Breeze 自己的那条规矩
 * （"按钮和文本框内部至少留 8px 的空当"）管的事——它管的是"至少"，
 * 不是"一模一样"；三个零件的内边距现在都是 `px-3 py-2` ✓，
 * 而那条门禁盯着它们别再变窄 ✓。
 */
/**
 * 那张脸**无效的时候**是什么样子 ✓。
 *
 * 按钮早就有这一条 ✓（`aria-invalid:border-destructive` ✓），
 * 字段却没有 ✗——所以 ✗**登录/注册页报错的字段** ✓ **不会变红** ✗，
 * 而**按钮会** ✗。
 *
 * 于是它也归到共享的这张脸上 ✓：**三个字段零件** ✓（输入框 ✓、下拉框 ✓、多行框 ✓）
 * **都认得 `aria-invalid`** ✓——**那一行是无效的** ✓，不是**它自己画的** ✓。
 */
export const FIELD_INVALID = 'aria-invalid:border-destructive focus-visible:aria-invalid:border-destructive'

export const FIELD_FACE = 'rounded-lg border border-input bg-card shadow-xs'
