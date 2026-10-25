/**
 * 焦点的那一圈。
 *
 * 按钮、输入框、下拉框、多行框是同一个应用里挨着放的东西——它们挨在一起的时候，
 * 焦点应该从这一个走到下一个，**长得一样** ✓。而它们原来各画各的 ✗：
 *
 * - 按钮：一圈淡环（`ring-ring/40` ✓）+ 偏移 ✓ + 偏移到背景色 ✓
 * - 输入框：一圈更淡的环（`ring-ring/25` ✗），**没有偏移** ✗
 * - 多行框：**连环都没有** ✗，只有一圈变蓝的边框 ✗
 * - 下拉框：更粗的一圈（`ring-ring` ✗）+ 偏移 ✓——而且它用 `focus:` 画着
 *   **"打开着"的样子** ✗（`focus:bg-accent` ✗），于是鼠标点它一下 ✗，
 *   它就长得像被键盘选中了 ✗。
 *
 * 于是**焦点环只写一处** ✓：几个零件都从这一处拿 ✓。
 * 而且它用的是 `focus-visible:` ✓——**键盘才亮** ✓，鼠标点不亮 ✓，
 * 这样"聚焦"和"打开着"才不是同一件事 ✗。
 *
 * **浓淡**是唯一的例外 ✗：一个 16px 的勾选框 ✗，套一圈 40% 的淡环 ✗，
 * 键盘上的人根本看不见 ✗。所以**更小的目标用更浓的那一副** ✓——副浓的也写在
 * 同一处 ✓，免得又变成"谁自己画的一圈" ✗。
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * 更浓的那一圈，给更小的目标。
 *
 * 勾选框是 16px ✓，开关是 24px ✓，而字段最小的一档是 32px ✓——
 * 比它还小的目标 ✗，才配得上这一副 ✓。
 */
export const FOCUS_RING_STRONG =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
