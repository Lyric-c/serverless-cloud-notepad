import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { CDN_PREFIX, SUPPORTED_LANG } from './constant'

dayjs.extend(relativeTime)

const HTML = ({ lang, title, content, ext = {}, tips, isEdit, initialEditable, showPwPrompt }) => `
<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — Cloud Notepad</title>
    <link href="${CDN_PREFIX}/favicon.ico" rel="shortcut icon" type="image/ico" />
    <link href="${CDN_PREFIX}/css/editor.css" rel="stylesheet" media="screen" />
</head>
<body>
    ${tips ? `<div class="tips">${tips}</div>` : ''}
    ${isEdit !== undefined ? `
    <div id="editor-root" style="width:100%;height:100vh;"></div>
    <script>
      window.__NOTE_INIT__ = {
        content: ${JSON.stringify(content)},
        path: ${JSON.stringify(title)},
        metadata: ${JSON.stringify({ ...ext, updateAt: ext.updateAt })},
        initialEditable: ${initialEditable !== undefined ? initialEditable : true},
        canToggle: ${isEdit}
      };
    </script>
    <script src="${CDN_PREFIX}/js/editor.js"></script>
    <script src="${CDN_PREFIX}/js/app.js"></script>
    ` : showPwPrompt ? `
    <script src="${CDN_PREFIX}/js/app.js"></script>
    <script>passwdPrompt()</script>
    ` : ''}
</body>
</html>
`

export const Edit = data => HTML({
    isEdit: true,
    initialEditable: !data.content,
    ...data
})
export const Share = data => HTML({ isEdit: false, initialEditable: false, ...data })
export const NeedPasswd = data => HTML({ tips: SUPPORTED_LANG[data.lang].tipEncrypt, showPwPrompt: true, ...data })
export const Page404 = data => HTML({ tips: SUPPORTED_LANG[data.lang].tip404, ...data })
