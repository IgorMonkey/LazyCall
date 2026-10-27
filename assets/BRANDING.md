# LazyCall branding

The sleeping character was supplied by the project owner in the
`sleepy_app_logo_pack` asset pack.

- `lazycall-logo.png`: original transparent marker drawing for large placements.
- `lazycall-logo-monochrome.png`: supplied denser monochrome version; the
  interface uses its alpha mask with the current theme's text colour at 48px
  in the main header and 36px in the compact window.
- `lazycall-wordmark.svg`: custom rounded handwritten lettering, selected by the
  owner from generated concepts and converted to solid vector paths. No font
  installation is required. The UI colours its mask to match the mascot.
- `lazycall-lockup.svg`: self-contained graphite mascot and wordmark composition.
- `lazycall-lockup-light.svg`: the same composition in a light colour for dark
  backgrounds. The mascot in these compositions is traced from the supplied
  monochrome image; the interface retains the supplied PNG mask.
- `lazycall-icon.png`: supplied 256px application icon.
- `lazycall-icon.ico`: Windows ICO container holding the supplied 48px, 96px and
  256px PNGs. The PNG artwork is retained without re-rendering.

The old `callme.*` files are retained as historical source assets; current
application and installer references use the LazyCall files above.
