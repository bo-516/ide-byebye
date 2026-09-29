/**
 * Root layout. The injector only edits modules that contain a `<body>` element,
 * so this file keeps `<body>` in the source.
 *
 * @param {{ children: unknown }} props Rendered page.
 * @returns {unknown} The document shell.
 */
export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
