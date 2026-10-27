# Interface layout

[Русский](UI_GUIDELINES.ru.md)

LazyCall uses a graphite palette with a coral action accent. Russian and English
use the same layout, typography and control sizes; translated content can wrap.

- Related controls stay together. Use 8px within a small group, 16px between
  related groups and 24px for regular dialog content insets. Compact layouts use
  smaller insets without changing the reading order.
- The main panes share grid rows for their headings, histories, field labels,
  text areas and actions. Each history scrolls independently. A longer answer,
  follow button or reconnection notice must not move the input controls.
- Dialog titles and footer actions stay visible while body content scrolls.
  Avoid nesting dialogs or adding a modal for a passive status update.
- Preserve visible keyboard focus, meaningful labels and native text selection.
  Use synthetic content when producing public screenshots.

These are project decisions informed by [Fluent layout guidance](https://fluent2.microsoft.design/layout),
[Fluent dialog behavior](https://fluent2.microsoft.design/components/web/react/core/dialog/usage),
and NN/g on [proximity](https://www.nngroup.com/articles/gestalt-proximity/)
and [visual consistency](https://www.nngroup.com/articles/why-does-design-look-good/).
They are not a claim of formal compliance or a substitute for user testing.

Run `node scripts/check-assistant-ui.cjs --spacing` for control and paired-pane
geometry, `--workspace-review` for responsive screenshots and state checks, and
`--transcript-follow` for independent scrolling behavior. The screenshot gallery
also covers settings, materials, projects, outcomes, onboarding and the compact window.
