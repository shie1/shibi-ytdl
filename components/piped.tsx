import axios from "axios"

export type PipedStream = {
    url: string
    codec: string
    quality: string
    itag: number
    mimeType: string
    sizeInBytes?: number
}

export type PipedDetails = {
    videoID: string
    title: string
    category: string
    description: string
    thumbnailUrl: string
    uploadDate: string
    uploader: string
    videoStreams: PipedStream[]
    audioStreams: PipedStream[]
}

export const sortInstances = (instances: PipedInstance[]): PipedInstance[] => {
    return instances.filter(instance => instance.online && instance.initialized).sort((a, b) => {
        if (a.ping < b.ping) return -1
        if (a.ping > b.ping) return 1
        return 0
    })
}

export const getFastestCDN = (instances: PipedInstance[]): PipedInstance | undefined => {
    const sorted = sortInstances(instances)
    return sorted.find(instance => instance.cdn)
}

export class PipedInstance {
    public readonly host: string
    public readonly domain: string
    public initialized: boolean = false
    public cdn: boolean = false
    public online: boolean = true
    public ping: number = 0
    constructor(host: string) {
        this.host = host
        this.domain = (new URL(host)).hostname
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            const res = await axios(this.host + "/streams/jNQXAC9IVRw", { timeout: 3000 });
            if (res.status !== 200) { throw new Error("Offline") }
            const startTime = performance.now();
            const stream = await axios.head(res.data.videoStreams[5].url, { timeout: 2000 })
            if (stream.status !== 200) { throw new Error("Offline") }
            const endTime = performance.now();
            this.cdn = stream.headers["content-length"] != undefined
            if (endTime - startTime === 0) { this.online = false }
            this.ping = endTime - startTime;
        } catch (error) {
            if (this.online) this.online = false;
        } finally {
            this.initialized = true;
        }
    }

    public async getStreams(videoID: string, instances: Array<PipedInstance>): Promise<PipedDetails> {
        try {
            if (!this.online) throw new Error("Offline")
            const backupCDNHost = getFastestCDN(sortInstances(instances))?.host || undefined
            console.log(`Requesting ${this.domain} for streams of ${videoID} (CDN: ${backupCDNHost})`, sortInstances(instances))

            const response = await axios.get(`${this.host}/streams/${videoID}`)
            const responseCDN = await axios.get(`${backupCDNHost}/streams/${videoID}`)

            // async map
            const audioStreams: PipedStream[] = await Promise.all(response.data.audioStreams.filter((stream: any) =>
                stream.mimeType.startsWith("audio") && stream.mimeType.split("/")[1] !== "webm"
            ).map(async (stream: any) => {
                const sizeInBytes = parseInt(await (await axios.head(responseCDN.data.audioStreams.find((s: any) => s.itag === stream.itag).url)).headers["content-length"])
                return {
                    url: stream.url,
                    codec: stream.codec,
                    quality: stream.quality,
                    itag: stream.itag,
                    mimeType: stream.mimeType,
                    sizeInBytes: sizeInBytes
                }
            }))
            const videoStreams: PipedStream[] = await Promise.all(response.data.videoStreams.filter(((stream: any) =>
                stream.mimeType.startsWith("video") && stream.quality.search("p") > -1 && stream.mimeType.split("/")[1] !== "3gpp"
            )).map(async (stream: any) => {
                const sizeInBytes = parseInt(await (await axios.head(responseCDN.data.videoStreams.find((s: any) => s.itag === stream.itag).url)).headers["content-length"])
                return {
                    url: stream.url,
                    codec: stream.codec,
                    quality: stream.quality,
                    itag: stream.itag,
                    mimeType: stream.mimeType,
                    sizeInBytes: sizeInBytes
                }
            }))

            const res: PipedDetails = {
                audioStreams: audioStreams,
                videoStreams: videoStreams,
                category: response.data.category,
                description: response.data.description,
                thumbnailUrl: response.data.thumbnailUrl,
                title: response.data.title,
                uploadDate: response.data.uploadDate,
                uploader: response.data.uploader,
                videoID: response.data.thumbnailUrl.split("/")[4]
            }

            console.log("Loaded streams: ", res)

            return res
        } catch (error) {
            console.error(error)
            if (this.online) this.online = false
            throw new Error("Offline")
        }
    }
}

export const defaultPipedInstaces: PipedInstance[] = ([
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.tokhmi.xyz",
    "https://pipedapi.moomoo.me",
    "https://pipedapi.syncpundit.io",
    "https://api-piped.mha.fi",
    "https://piped-api.garudalinux.org",
    "https://pipedapi.rivo.lol",
    "https://pipedapi.aeong.one",
    "https://pipedapi.leptons.xyz",
    "https://piped-api.lunar.icu",
    "https://ytapi.dc09.ru",
    "https://pipedapi.colinslegacy.com",
    "https://yapi.vyper.me",
    "https://pipedapi-libre.kavin.rocks",
    "https://pa.mint.lgbt",
    "https://pa.il.ax",
    "https://api.piped.projectsegfau.lt",
    "https://pipedapi.in.projectsegfau.lt",
    "https://pipedapi.us.projectsegfau.lt",
    "https://watchapi.whatever.social",
    "https://api.piped.privacydev.net",
    "https://pipedapi.palveluntarjoaja.eu",
    "https://pipedapi.smnz.de",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.qdi.fi",
    "https://piped-api.hostux.net",
    "https://pdapi.vern.cc",
    "https://pipedapi.jotoma.de",
    "https://pipedapi.pfcd.me",
    "https://pipedapi.frontendfriendly.xyz",
    "https://api.piped.yt",
    "https://pipedapi.astartes.nl",
    "https://pipedapi.osphost.fi",
    "https://pipedapi.simpleprivacy.fr"
].map(host => new PipedInstance(host)))

export const OfficialPipedInstance = new PipedInstance("https://pipedapi.kavin.rocks")