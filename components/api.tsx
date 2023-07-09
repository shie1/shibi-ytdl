import axios, { AxiosHeaders, RawAxiosRequestConfig } from 'axios'

export const getHost = (req: any) => {
    const host = process.env.NODE_ENV === 'development' ? "http://localhost:3000" : "https://menetrendek.info"
    return host
}

export const apiCall = async (method: "GET" | "POST", url: string, body?: any) => {
    switch (method) {
        case 'GET':
            return (await axios.get(url, { params: body })).data as any
        case 'POST':
            return (await axios.post(url, body)).data as any
    }
}