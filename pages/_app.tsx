import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import 'antd/dist/reset.css';
import { Layout, ConfigProvider, theme, Menu } from "antd"
import Head from 'next/head';

export default function App({ Component, pageProps }: AppProps) {
  return (<>
    <Head>
      <title>Shibi-YTDL</title>
      <meta name="viewport" content="minimum-scale=1, initial-scale=1, width=device-width" />

      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <link rel='icon' type="image/x-icon" href='/favicon.ico' />
      <meta property="og:type" content="website" />
      <meta property="twitter:card" content="summary_large_image" />
    </Head>
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#8B0000', // Dark red color
      },
    }}>
      <Layout>
        <Layout.Content style={{ minHeight: '100dvh' }}>
          <div className="container" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <Component {...pageProps} />
          </div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  </>)
}
