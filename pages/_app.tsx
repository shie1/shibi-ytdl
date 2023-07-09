import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import 'antd/dist/reset.css';
import { Layout, ConfigProvider, theme, Menu } from "antd"

export default function App({ Component, pageProps }: AppProps) {
  return (<>
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
