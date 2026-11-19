/**
 * zh/en copy for images pasted into the intent dialog.
 *
 * Purpose: `i18n.ts` sits near the 400-line cap, so this feature's strings live here and are spread into its table.
 * Boundary: presentation copy only. Thumbnail and lightbox controls reuse the `screenshot.*` strings.
 *
 * @type {Record<string, { zh: string, en: string }>}
 */
export const IMAGE_STRINGS: Record<string, { zh: string; en: string }> = {
    'image.pasted.label': { zh: '粘贴的图片 {n}', en: 'Pasted image {n}' },
    'image.paste.tooMany': { zh: '最多只能粘贴 {max} 张图片', en: 'You can paste up to {max} images' },
    'image.paste.decodeFailed': { zh: '无法读取粘贴的图片', en: 'Could not read the pasted image' },
    'image.paste.tooLarge': {
        zh: '粘贴的图片太大，压缩后仍超过上限',
        en: 'The pasted image is too large, even after compressing it',
    },
    'image.delivery.path': {
        zh: '发送时保存为文件，路径写进 prompt，由 {label} 打开查看',
        en: 'Saved as a file on send; {label} gets its path in the prompt and opens it',
    },
    'image.delivery.attachment': {
        zh: '发送时保存为文件，并作为文件附件交给 {label}',
        en: 'Saved as a file on send and attached to {label} as a file',
    },
};
