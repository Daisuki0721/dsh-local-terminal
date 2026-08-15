export const XTERM_CSS = `
.xterm{cursor:text;position:relative;user-select:none;height:100%}.xterm.focus,.xterm:focus{outline:none}
.xterm .xterm-helpers{position:absolute;top:0;z-index:5}.xterm .xterm-helper-textarea{padding:0;border:0;margin:0;position:absolute;opacity:0;left:-9999em;top:0;width:0;height:0;z-index:-5;white-space:nowrap;overflow:hidden;resize:none}
.xterm .composition-view{background:#0b1020;color:#fff;display:none;position:absolute;white-space:nowrap;z-index:1}.xterm .composition-view.active{display:block}
.xterm .xterm-viewport{background-color:#081020;overflow-y:scroll;cursor:default;position:absolute;inset:0}.xterm .xterm-screen{position:relative}.xterm .xterm-screen canvas{position:absolute;left:0;top:0}
.xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;top:0;left:-9999em;line-height:normal}
.xterm .xterm-accessibility:not(.debug),.xterm .xterm-message{position:absolute;inset:0;z-index:10;color:transparent;pointer-events:none}.xterm .xterm-accessibility-tree{font-family:monospace;user-select:text;white-space:pre}.xterm .live-region{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
`
