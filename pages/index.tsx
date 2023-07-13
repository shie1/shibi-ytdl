import type { NextPage } from "next"
import { Input, Typography, Modal, Select, Spin, notification, Divider } from "antd";
import { motion, AnimatePresence } from "framer-motion"
import { Dispatch, SetStateAction, memo, useEffect, useState } from "react";
import { getVideoIDFromURL } from "@/components/strings"
import { apiCall } from "@/components/api";
import Image from "next/image"
import { createFFmpeg } from '@ffmpeg/ffmpeg';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { IconCheck, IconDeviceMobileOff, IconExternalLink, IconMovie, IconSearch, IconSearchOff, IconTrashX, IconUpload, IconX } from "@tabler/icons-react"
import Head from "next/head"
import axios, { AxiosHeaders, AxiosResponse } from "axios";
import { useRouter } from "next/router";
import { NotificationInstance } from "antd/es/notification/interface";
import { humanFileSize } from "@/components/humanbytes";

const PIPED = "https://pipedapi.kavin.rocks/"

const videoDisallowedITags: Array<number> = []
const audioDisallowedITags: Array<number> = []

const normals = /[A-z1-9]/gi
const titleRegex = /[^0-9A-záéíóöőúüű]+/gi
const parenthesesRegex = /[\(\[\{]([^)]+)[\)\]\}]/g

const ffmpegNormalize = (str: string) => {
  let res = ""
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    // if normal return as is, if not return as unicode escape
    res += char.match(normals) ? char : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  }
  return res
}

const itunesSearchAlbumCover = async (query: string) => {
  try {
    const response = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: query,
        media: 'music',
        entity: 'song',
        limit: 1
      }
    });

    const album = response.data.results[0];
    if (album && album.artworkUrl100) {
      return (await axios.get(album.artworkUrl100, {
        responseType: 'arraybuffer'
      })).data;
    } else {
      throw new Error('No album cover found.');
    }
  } catch (error) {
    throw new Error('Failed to retrieve album cover: ' + error);
  }
}

type Container = {
  value: string,
  type: "video" | "audio" | "videoonly" | undefined
}

const containers: Array<Container> = [
  {
    value: "gif",
    type: "videoonly",
  },
  {
    value: "mp4",
    type: "video"
  },
  {
    value: "mp3",
    type: "audio"
  },
  {
    value: "flac",
    type: "audio"
  },
  {
    value: "wav",
    type: "audio"
  },
  {
    value: "webm",
    type: "video"
  },
  {
    value: "avi",
    type: "video"
  },
  {
    value: "mov",
    type: "video"
  },
]

const defaultContainer = containers[1]

const weightedPercentage = (a: { weight: number, value: number }, b: { weight: number, value: number }) => {
  // Ensure the input percentages are between 0 and 100
  a.value = Math.min(Math.max(a.value, 0), 100);
  b.value = Math.min(Math.max(b.value, 0), 100);

  // Normalize the weights
  const totalWeight = a.weight + b.weight;
  const normalizedWeight1 = a.weight / totalWeight;
  const normalizedWeight2 = b.weight / totalWeight;

  // Calculate the weighted average
  const weightedPercentage1 = a.value * normalizedWeight1;
  const weightedPercentage2 = b.value * normalizedWeight2;
  const averagePercentage = weightedPercentage1 + weightedPercentage2;

  return averagePercentage;
}

const blobToArrayBuffer = (blob: Blob): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const buffer = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buffer));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
};

const fetchWithProgress = async (url: string, params?: { timeout?: number, progressCallback?: (loaded: number, total: number, dlStart: number) => void, abortController?: AbortController }): Promise<Uint8Array | undefined> => {
  try {
    const dlStart = (new Date()).getTime()
    const response: AxiosResponse = await axios.get(url, {
      responseType: "blob",
      signal: params?.abortController?.signal,
      onDownloadProgress: (progressEvent) => {
        if (params?.progressCallback) params.progressCallback(progressEvent.loaded, progressEvent.total!, dlStart);
      },
    });

    const blob = response.data;
    const result = await blobToArrayBuffer(blob);

    return result;
  } catch (error) {
    return
  }
};

const createVideo = async (
  videoOptions: {
    videoStream?: string,
    audioStream?: string,
    container: string,
    metadata?: {
      title: string,
      artist: string,
      album: string,
      date: number,
      albumArt: Uint8Array,
    },
  },
  modules: {
    ffmpeg: FFmpeg,
    notifications: NotificationInstance
  },
  callbacks?: {
    onProgress?: (progress: number, total: number, dlStart: number) => void,
    onAbort?: () => void,
  }
) => {
  // Init
  const ac = new AbortController()
  const conversionId = (new Date()).getTime()
  let aborted = false

  // Log start
  console.log("Starting conversion: #", conversionId)

  // End function
  const end = () => {
    // Log end
    console.log("Ended process #", conversionId)

    // Notification: Download complete
    modules.notifications.open({
      message: 'Download complete.',
      description: 'Your download is ready.',
      placement: 'bottomRight',
      key: 'videocreation-state',
      duration: 4.5,
      closeIcon: <IconX />,
      icon: <IconCheck />,
    })
  }

  // Notficiation: Downloading streams
  modules.notifications.open({
    message: "Downloading stream(s)...",
    description: 'This may take a while depending on the length and quality of the video and your internet connection',
    duration: 0,
    placement: 'bottomRight',
    key: 'videocreation-state',
    onClose: () => {
      ac.abort()
      callbacks?.onAbort?.()
    },
    closeIcon: <IconX />,
    icon: <Spin />,
  });

  // Download streams
  const [videoStream, audioStream] = await (() => {
    if (!videoOptions.videoStream && !videoOptions.audioStream) return Promise.resolve([undefined, undefined])
    // paralell downloads
    return Promise.all([
      videoOptions.videoStream ? fetchWithProgress(videoOptions.videoStream!, { abortController: ac, progressCallback: callbacks?.onProgress }) : undefined,
      videoOptions.audioStream ? fetchWithProgress(videoOptions.audioStream!, { abortController: ac, progressCallback: callbacks?.onProgress }) : undefined
    ])
  })()

  // Write streams to ffmpeg memory
  if (videoStream) {
    modules.ffmpeg.FS('writeFile', `input_video_${conversionId}`, videoStream)
  }
  if (audioStream) {
    modules.ffmpeg.FS('writeFile', `input_audio_${conversionId}`, audioStream)
  }

  modules.notifications.open({
    message: 'Merging video and audio streams...',
    description: `Using your hardware to merge the streams.`,
    duration: 0,
    placement: 'bottomRight',
    key: 'videocreation-state',
    className: 'noclose',
    icon: <IconMovie />,
  })

  let command;

  switch (`${videoStream ? '1' : '0'}${audioStream ? !videoOptions.metadata ? '1' : '2' : '0'}`) {
    case "00": // No streams
      modules.notifications.destroy("videocreation-state")
      console.log("Aborted process: #", conversionId)
      throw new Error("Aborted")
    case "01": // Audio only
      // construct the command with variables: ffmpeg -i input_audio.mp3 -c copy output_audio.mp3
      command = `-i input_audio_${conversionId} -f ${videoOptions.container} output_${conversionId}.${videoOptions.container}`

      // Run ffmpeg
      await modules.ffmpeg.run(...command.split(" "))

      end()

      return modules.ffmpeg.FS('readFile', `output_${conversionId}.${videoOptions.container}`)
    case "02": // Audio and metadata
      if (!videoOptions.metadata) return

      // Write album art to ffmpeg memory
      modules.ffmpeg.FS('writeFile', `input_cover_${conversionId}`, videoOptions.metadata.albumArt)

      // construct the command with variables: ffmpeg -i input_audio.mp3 -i input_image.jpg -map 0 -map 1 -c copy -metadata title="Song Title" -metadata artist="Artist Name" -metadata album="Album Name" -metadata year="2023" -metadata date="2023-07-13" -id3v2_version 3 -write_id3v1 1 output_audio.mp3
      command = `-i input_audio_${conversionId} -i input_cover_${conversionId} -map 0 -map 1 -metadata:s:a:0 Title="${ffmpegNormalize(videoOptions.metadata?.title)}" -metadata:s:a:0 Artist="${ffmpegNormalize(videoOptions.metadata?.artist)}" -metadata:s:a:0 Album="${ffmpegNormalize(videoOptions.metadata?.album)}" -metadata:s:a:0 Year="${videoOptions.metadata?.date}" -f ${videoOptions.container} -id3v2_version 3 -write_id3v1 1 output_${conversionId}.${videoOptions.container}`

      // Run ffmpeg
      await modules.ffmpeg.run(...command.split(" "))

      end()

      return modules.ffmpeg.FS('readFile', `output_${conversionId}.${videoOptions.container}`)
    case "10": // Video only
      // construct the command with variables: ffmpeg -i input_video.mp4 -c copy output_video.mp4
      command = `-i input_video_${conversionId} -f ${videoOptions.container} output_${conversionId}.${videoOptions.container}`
      // Run ffmpeg
      await modules.ffmpeg.run(...command.split(" "))

      end()

      return modules.ffmpeg.FS('readFile', `output_${conversionId}.${videoOptions.container}`)
    case "11": // Video and audio
      // construct the command with variables: ffmpeg -i input_video.mp4 -i input_audio.mp3 -c copy -map 0:v:0 -map 1:a:0 -shortest output_video.mp4
      command = `-i input_video_${conversionId} -i input_audio_${conversionId} -c copy -map 0:v:0 -map 1:a:0 -shortest -f ${videoOptions.container} output_${conversionId}.${videoOptions.container}`
      // Run ffmpeg
      await modules.ffmpeg.run(...command.split(" "))

      end()

      return modules.ffmpeg.FS('readFile', `output_${conversionId}.${videoOptions.container}`)
  }
}

const PageBackground = memo(({ bg, videoID }: { bg: Blob, videoID: string }) => (<motion.div
  key={videoID}
  initial={{
    transform: `scale(1.2) translateY(5vh) rotate(0deg) translateX(${bg ? -100 : 0}vw)`
  }}
  animate={{
    transform: `scale(1.2) translateY(0vh) rotate(5deg) translateX(${bg ? 0 : -100}vw)`
  }}
  exit={{
    transform: `scale(1.2) translateY(-10vh) rotate(15deg) translateX(${bg ? 100 : 0}vw)`
  }}
  style={{ backgroundImage: `url("${URL.createObjectURL(bg)}")` }}
  className="bg" />))

const VideoDetails = memo(({ video, bg, videoID }: { video: any, bg: Blob, videoID: string }) => (<>
  <motion.div
    initial={{ height: 0 }}
    animate={{ height: 'auto' }}
    exit={{ height: 0 }}
    style={{ overflow: 'hidden', marginBottom: '0.5rem' }}
  >
    <div style={{
      height: '26dvh',
      maxHeight: '50vmin',
      width: 'min-content',
      margin: 'auto',
      marginBottom: '.5rem',
      borderRadius: 10,
      overflow: 'hidden',
      position: 'relative'
    }}>
      <div
        className="display-on-hover"
        onClick={() => { window.open(`https://youtu.be/${videoID}`) }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'rgba(0,0,0,.4)',
        }}
      >
        <IconExternalLink color="white" size={50} />
      </div>
      <Image draggable={false} alt={video.title} src={URL.createObjectURL(bg)} width={1280} height={720} style={{ objectFit: 'contain', height: '26dvh', maxHeight: '50vmin', width: 'auto', marginBottom: '.5rem', }} />
    </div>
    <Typography.Title style={{ fontSize: '1.8rem', textOverflow: 'ellipsis', overflow: 'hidden', width: '100%', margin: 0, lineClamp: 2, WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: 'vertical' }} className="center horizontal vertical">{video.title}</Typography.Title>
    <Typography.Text style={{ fontSize: '1rem' }} className="center horizontal vertical">{video.uploader}</Typography.Text>
  </motion.div>
</>))

const Home: NextPage = (props: any) => {
  // Initializers
  const router = useRouter()
  const [notifications, contextHolder] = notification.useNotification();
  const [ffmpeg, setFFmpeg] = useState<FFmpeg | undefined>(undefined)
  const [ffmpegReady, setFFmpegReady] = useState<boolean>(false)

  // Download options
  const [container, setContainer] = useState<Container>(defaultContainer)
  const [videoStream, setVideoStream] = useState<string | undefined>()
  const [audioStream, setAudioStream] = useState<string | undefined>()

  // Video Data
  const [query, setQuery] = useState<string>(router.query["v"] ? "https://youtu.be/" + router.query["v"] as string : "")
  const [videoID, setVideoID] = useState<string | undefined>(props.videoID)
  const [video, setVideo] = useState<any>(props.videoDataPreload)

  // UI
  const [bg, setBg] = useState<Blob | undefined>(undefined)
  const [prefsOpen, setPrefsOpen] = useState<boolean>(false)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [inProgress, setInProgress] = useState<boolean>(false)
  const [dlProgress, setDlProgress] = useState<Array<{ progress: number, total: number, dlStart: number }>>([])

  // add together dl progress values and totals and get percentage
  const dlProgressPercentage = dlProgress.length > 0 ? dlProgress.reduce((acc, obj) => acc + obj.total, 0) - dlProgress.reduce((acc, obj) => acc + obj.progress, 0) : 0
  const ready = video && bg

  useEffect(() => {
    console.log(dlProgress, dlProgressPercentage)
  }, [dlProgress])

  // Initialize ffmpeg
  useEffect(() => {
    if (!ffmpeg) {
      setFFmpeg(createFFmpeg({
        log: true,
        corePath: `${process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://ytdl.shie1bi.hu"}/ffmpeg-core.js`
      }))
    }
  }, [ffmpeg])

  // Reset download progress when inProgress changes
  useEffect(() => {
    if (!inProgress) setDlProgress([])
  }, [inProgress])

  // Check for mobile
  useEffect(() => {
    if (typeof window === "undefined") return
    const ua = navigator.userAgent.toLowerCase();
    if (ua.search("mobile") > -1) {
      notifications.error({
        message: 'Unsupported device.',
        description: 'This website is not supported on mobile devices.',
        placement: 'bottomRight',
        key: 'unsupported',
        duration: 0,
        icon: <IconDeviceMobileOff />
      })
    }
  }, [])

  // Load ffmpeg
  useEffect(() => {
    if (ffmpeg && !ffmpegReady) { ffmpeg.load(); setFFmpegReady(true) }
  }, [ffmpeg, ffmpegReady])

  // Get video ID from query
  useEffect(() => {
    const id = getVideoIDFromURL(query)
    if (id != props.videoID) { setVideoID(undefined); setVideo(undefined); setBg(undefined); setVideoStream(undefined); setAudioStream(undefined); setContainer(defaultContainer) }
    if (!query || !id) { return }
    setVideoID(id)
  }, [query])

  // Get video data from API
  useEffect(() => {
    notifications.destroy("data-download-error")
    if (!videoID) { router.push(`/`); return }
    if (videoID == video?.thumbnailUrl.split("/")[4]) { return }
    router.push(`/?v=${videoID}`)
    apiCall("GET", `${PIPED.replace(/\/$/, '')}/streams/${videoID}`).then((res) => {
      setVideo(res)
    }).catch(() => {
      notifications.error({
        message: 'Error occurred.',
        description: 'An error occurred while trying to get video data.',
        placement: 'bottomRight',
        key: 'data-download-error',
        className: 'noclose',
        duration: 0,
        icon: <IconX />
      })
    })
  }, [videoID])

  // Get video thumbnail
  useEffect(() => {
    if (!video) return
    fetch(video.thumbnailUrl).then(async (res: any) => {
      setBg(await res.blob())
    })
  }, [video])

  //cut off metadesc at 167 characters and add ... to the end
  const metaDescription = (
    (props.videoDataPreload
      ? `Download ${props.videoDataPreload.title} YouTube video from ${props.videoDataPreload.uploader}: ` + props.videoDataPreload.description.replace(/(<([^>]+)>)/gi, "")
      : "Unlock the Speed of YouTube Downloads! Experience lightning-fast video downloads like never before with our cutting-edge website. Download your favorite YouTube videos with blazing speed and incredible ease. Say goodbye to buffering and waiting, and say hello to instant gratification. Try it now and discover the fastest way to download YouTube videos!") as string
  ).substring(0, 167) + "..."
  const metaTitle = (props.videoDataPreload ? `Download "${props.videoDataPreload.title}" with ` : "") + "Shibi-YTDL"
  const metaImage = props.videoDataPreload ? props.videoDataPreload.thumbnailUrl : ""

  return <>
    <Head>
      <meta name="description" content={metaDescription} />
      <meta property="og:url" content="https://ytdl.shie1bi.hu" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={metaTitle} />
      <meta property="og:description" content={metaDescription} />
      <meta property="og:image" content={metaImage} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta property="twitter:domain" content="ytdl.shie1bi.hu" />
      <meta property="twitter:url" content="https://ytdl.shie1bi.hu" />
      <meta name="twitter:title" content={metaTitle} />
      <meta name="twitter:description" content={metaDescription} />
      <meta name="twitter:image" content={metaImage} />
    </Head>
    {contextHolder}
    <motion.div id="inner" style={{
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      position: 'relative',
    }}>
      <div className="bg-container">
        <AnimatePresence>
          {ready &&
            <PageBackground key="pageBg" videoID={videoID!} bg={bg} />}
          {(inProgress) &&
            <motion.div
              key="topbar"
              initial={{
                width: '0vw',
              }}
              animate={{
                width: `100vw`,
              }}
              exit={{
                width: '0vw',
              }}
              className="bg-top-bar" />}
          {(inProgress) &&
            <motion.div
              initial={{
                width: `${100 - dlProgressPercentage}%`,
                opacity: 0
              }}
              animate={{
                width: `${100 - dlProgressPercentage}%`,
                opacity: 1
              }}
              exit={{
                width: `${100 - dlProgressPercentage}%`,
                opacity: 0
              }}
              className="bg-filter" />
          }
        </AnimatePresence>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexDirection: 'column' }} >
        <Typography.Title style={{ fontSize: '4rem', margin: 0, display: 'inline-block', textAlign: 'center' }}>
          <span style={{ verticalAlign: "bottom" }}><Image draggable={false} alt="Shibi-YTDL logo" width={75} height={75} src="/logo.png" /> </span>
          <span>/Shibi-YTDL/</span>
        </Typography.Title>
        <Typography.Text style={{ fontSize: '2rem' }} className="center horizontal vertical">
          A simple YouTube downloader
        </Typography.Text>
      </div>
      <div style={{
        flexGrow: 1,
        alignSelf: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }} className="center horizontal vertical">
        <AnimatePresence>
          {ready && <VideoDetails videoID={videoID!} bg={bg} video={video} />}
        </AnimatePresence>
        <motion.div animate={{ width: '100%' }} layout>
          <Input.Search
            onPaste={(e) => {
              e.preventDefault()
              setQuery(e.clipboardData.getData('Text'))
            }}
            onClick={() => {
              //check for clipboard permission
              navigator.permissions.query({ name: "clipboard-read" as any }).then((result) => {
                if (result.state == "granted" || result.state == "prompt") {
                  navigator.clipboard.readText().then((text) => {
                    const id = getVideoIDFromURL(text)
                    if (!id) return
                    setQuery(text)
                  })
                }
              }).catch((_err) => {
                // no clipboard API (Firefox) 
              })
            }} disabled={inProgress} loading={query.length !== 0 && !ready} value={query} onSearch={() => { if (ready) setModalOpen(true) }} onChange={(e) => {
              if (e.nativeEvent.type == "input") {
                setQuery(e.target.value)
              } else if (e.nativeEvent.type == "insertFromPaste") {
                e.preventDefault()
              }
            }} placeholder="https://youtu.be/dQw4w9WgXcQ" enterButton="Download" style={{ width: '100%' }} size="large" />
        </motion.div>
      </div >
      <DownloadOptionsModal notifications={notifications} video={video} bg={bg} ffmpeg={ffmpeg} state={{
        open: { modalOpen, setModalOpen },
        inProgress: { inProgress, setInProgress },
        videoStream: { videoStream, setVideoStream },
        audioStream: { audioStream, setAudioStream },
        container: { container, setContainer },
        dlProgress: { dlProgress, setDlProgress },
      }} />
      <Modal
        title="Preferences"
        open={prefsOpen}
        onCancel={() => setPrefsOpen(false)}
        onOk={() => {
          setPrefsOpen(false)
        }}
      >

      </Modal>
      <div className="center horizontal vertical" style={{
        flexDirection: 'column'
      }}>
        <Typography.Text onClick={() => setPrefsOpen(true)} style={{ display: 'none', fontSize: '1.2rem', cursor: 'pointer', textDecoration: 'underline' }}>
          Open preferences
        </Typography.Text>
        <Typography.Text style={{ fontSize: '1rem' }}>
          Made with Next.js, Ant Design, Framer Motion, Piped and FFmpeg{"(WASM)"}.
        </Typography.Text>
      </div>
    </motion.div >
  </>;
}

const ModalTopBox = memo(({ bg, video }: { bg: Blob, video: any }) => (<div style={{
  display: 'flex',
  width: '100%',
  height: 200,
  flexDirection: 'row',
  alignItems: 'end',
  position: 'relative',
  backgroundImage: `url("${URL.createObjectURL(bg)}")`,
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  borderRadius: '10px',
}}>
  <div style={{
    borderRadius: '0 0 10px 10px',
    background: 'rgba(0,0,0,.7)', padding: '.2rem', display: 'flex', flexDirection: 'column', width: '100%'
  }}>
    <Typography.Text style={{ fontSize: '1rem', lineClamp: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', WebkitLineClamp: 1, width: '100%' }}>
      {video.title}
    </Typography.Text>
    <Typography.Text style={{ fontSize: '.8rem' }}>
      {video.uploader}
    </Typography.Text>
  </div>
</div>))

const DownloadOptionsModal = (
  {
    video,
    bg,
    ffmpeg,
    notifications,
    state
  }: {
    video: any,
    bg: any,
    notifications: NotificationInstance,
    ffmpeg: FFmpeg | undefined,
    state: {
      open: { modalOpen: boolean, setModalOpen: Dispatch<SetStateAction<boolean>> },
      inProgress: { inProgress: boolean, setInProgress: Dispatch<SetStateAction<boolean>> },
      videoStream: { videoStream: string | undefined, setVideoStream: Dispatch<SetStateAction<string | undefined>> },
      audioStream: { audioStream: string | undefined, setAudioStream: Dispatch<SetStateAction<string | undefined>> },
      container: { container: Container, setContainer: Dispatch<SetStateAction<Container>> },
      dlProgress: { dlProgress: Array<{ progress: number, total: number, dlStart: number }>, setDlProgress: Dispatch<SetStateAction<Array<{ progress: number, total: number, dlStart: number }>>> },
    }
  }
) => {
  // UI
  const [containerIsString, setContainerIsString] = useState<boolean>(false)
  const [downloadSpeedBytesPerSecond, setDownloadSpeedBytesPerSecond] = useState<number | undefined>(undefined)

  // Download options
  const [videoStreams, setVideoStreams] = useState<Array<{ label: string, value: string, size: number }>>([])
  const [audioStreams, setAudioStreams] = useState<Array<{ label: string, value: string, size: number }>>([])

  // Song metadata
  const [metadataTitle, setMetadataTitle] = useState<string | undefined>(undefined)
  const [metadataArtist, setMetadataArtist] = useState<string | undefined>(undefined)
  const [metadataAlbum, setMetadataAlbum] = useState<string | undefined>(undefined)
  const [metadataAlbumArt, setMetadataAlbumArt] = useState<Uint8Array | undefined>(undefined)
  const [metadataDate, setMetadataDate] = useState<number | undefined>(undefined)

  const refreshCover = () => itunesSearchAlbumCover((metadataArtist ? `${metadataArtist} ` : '') + (metadataAlbum ? metadataAlbum : metadataTitle))
    .then(setMetadataAlbumArt)
    .catch(() => notifications.error({
      message: 'No album cover found for this song.',
      description: 'Try uploading one manually.',
      placement: 'bottomRight',
      key: 'no-cover',
      duration: 4.5,
      closeIcon: <IconX />,
      icon: <IconSearchOff />,
    }))

  // Deconstruct state
  const { modalOpen, setModalOpen } = state.open
  const { inProgress, setInProgress } = state.inProgress
  const { videoStream, setVideoStream } = state.videoStream
  const { audioStream, setAudioStream } = state.audioStream
  const { container, setContainer } = state.container
  const { dlProgress, setDlProgress } = state.dlProgress
  const ready = video && bg

  // Get selected stream sizes
  const videoStreamSizeBytes = videoStreams && videoStream !== "off" ? videoStreams.find((s) => s.value === (videoStream ? videoStream : videoStreams[1].value))?.size : undefined
  const audioStreamSizeBytes = audioStreams && audioStream !== "off" ? audioStreams.find((s) => s.value === (audioStream ? audioStream : audioStreams[1].value))?.size : undefined

  // Calculate download time
  const estimatedDownloadTimeSeconds = ((videoStreamSizeBytes || 0) + (audioStreamSizeBytes || 0)) / (downloadSpeedBytesPerSecond || 0)

  // Reset props when video changes
  useEffect(() => {
    setMetadataAlbumArt(undefined)
    setMetadataAlbum(undefined)
    setMetadataArtist(undefined)
    setMetadataTitle(undefined)
    setMetadataDate(undefined)
  }, [video])

  // Get download speed
  useEffect(() => {
    if (typeof window === "undefined") return
    setDownloadSpeedBytesPerSecond((window.navigator as any).connection.downlink * 125000)
  }, [])

  // Retrive streams
  useEffect(() => {
    if (!video) return

    // Set video streams
    Promise.all(video.videoStreams.filter((stream: any) =>
      stream.mimeType.startsWith("video") && stream.quality.search("p") > -1 && !videoDisallowedITags.includes(stream.itag) && stream.mimeType.split("/")[1] !== "3gpp"
    ).map(async (stream: any) => {
      const headers = new AxiosHeaders()
      headers.set('accept-Encoding', 'identity')
      return {
        label: `${stream.quality} (${stream.mimeType})`,
        value: stream.url,
        size: parseInt((await axios.head(stream.url, { headers })).headers['content-length'])
      }
    })).then((res) => { // Sort video streams
      setVideoStreams([{
        label: "No video",
        value: "off",
        size: 0
      }, ...res.sort((a: any, b: any) => {
        // 1080p60 > 1080p > 720p60 > 720p > 480p > 360p > 240p > 144p
        const aq = a.label.split(' ')[0]
        const bq = b.label.split(' ')[0]
        const aq2 = aq.split('p')[0]
        const bq2 = bq.split('p')[0]
        const aq3 = aq.split('p')[1]
        const bq3 = bq.split('p')[1]
        if (aq2 === bq2) {
          return parseInt(bq3) - parseInt(aq3)
        }
        return parseInt(bq2) - parseInt(aq2)
      })])
    }).catch(() => { })

    // Set audio streams
    Promise.all(video.audioStreams.filter((stream: any) =>
      stream.mimeType.startsWith("audio") && !audioDisallowedITags.includes(stream.itag) && stream.mimeType.split("/")[1] !== "webm"
    ).map(async (stream: any) => {
      return {
        label: !stream.quality.startsWith("0") ? `${stream.quality} (${stream.mimeType})` : `default (${stream.mimeType})`,
        value: stream.url,
        size: parseInt((await axios.head(stream.url)).headers['content-length'])
      }
    })).then((res) => { // Sort audio streams
      setAudioStreams([{
        label: "No audio",
        value: "off",
      }, ...res.sort((a: any, b: any) => {
        const aq = a.label.split(' ')[0]
        const bq = b.label.split(' ')[0]
        return parseInt(bq) - parseInt(aq)
      })])
    }).catch(() => { })
  }, [video])

  // Retrive metadata
  useEffect(() => {
    let mm = {
      title: '',
      artist: '',
      album: '',
      date: (video?.uploadDate || `${(new Date()).getFullYear()}-`).split("-")[0],
    }
    // if video title contains the artist name, use that
    if (video?.title.toLowerCase().includes(video?.uploader.toLowerCase())) {
      mm.artist = video?.uploader
      mm.title = video?.title.replace(video?.uploader, "").replace(parenthesesRegex, '').replace(titleRegex, ' ').replace(/^ +| +$/g, '')
    } else {
      mm.title = video?.title.replace(parenthesesRegex, '').replace(titleRegex, ' ').replace(/^ +| +$/g, '')
    }

    setMetadataTitle(mm.title)
    setMetadataArtist(mm.artist)
    setMetadataDate(mm.date)
  }, [video, bg])

  // Check if stream sizes are ready
  const streamSizesReady = videoStream !== "off" ? videoStreamSizeBytes !== undefined : true && audioStream !== "off" ? audioStreamSizeBytes !== undefined : true

  // Retrive containers
  //   if only video, then video containers, if only audio, then audio containers, if both, then video containers, if none, then none
  //   ignore videostreams and audiostreams, just use the container
  const availableContainers = !video ? [] : containers.filter((c) => {
    if (audioStream === "off" && videoStream === "off") {
      return false
    } else if (audioStream !== "off" && videoStream !== "off") {
      if (c.type === "video") {
        return true
      }
    } else {
      if ((c.type === "video" || c.type === "videoonly") && videoStream !== "off") {
        return true
      }
      if (c.type === "audio" && audioStream !== "off") {
        return true
      }
    }
    return false
  })

  // Set default container
  useEffect(() => {
    if (!containerIsString && !availableContainers.map((c) => c.value).includes(container?.value)) { setContainer(availableContainers[0]) }
  }, [availableContainers])

  // Handle album art upload
  const handleAlbumArtUpload = (e: any) => {
    if (!e.target.files || !e.target.files[0]) return
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (!result) return
      setMetadataAlbumArt(new Uint8Array(result as ArrayBuffer))
    }
    reader.readAsArrayBuffer(file)
  }

  return <Modal
    title="Download video"
    open={modalOpen && ready}
    onCancel={() => setModalOpen(false)}
    onOk={async () => {
      if (!ffmpeg) return
      // Initialize
      setModalOpen(false)
      setInProgress(true)

      // If no stream selected, use the first one
      const vStreamUrl = videoStream === "off" ? undefined : videoStream || videoStreams[1].value
      const aStreamUrl = audioStream === "off" ? undefined : audioStream || audioStreams[1].value

      // Start download
      const ffmpegResult = await createVideo({
        container: container.value,
        videoStream: vStreamUrl,
        audioStream: aStreamUrl,
        // ...(video.category === "Music" ? {
        //   metadata: {
        //     title: metadataTitle!,
        //     artist: metadataArtist!,
        //     album: metadataAlbum || metadataTitle!,
        //     albumArt: new Uint8Array(metadataAlbumArt!),
        //     date: metadataDate!,
        //   }
        // } : {})
      }, {
        ffmpeg,
        notifications
      }, {
        onProgress: (progress: number, total: number, dlStart: number) => {
          setDlProgress((old) => {
            // if item with dlstart not present, append, else change it
            if (!old.find((item) => item.dlStart === dlStart)) {
              return [...old, { progress, total, dlStart }]
            }
            return old.map((item) => {
              if (item.dlStart === dlStart) {
                return { progress, total, dlStart }
              }
              return item
            })
          })
        }
      }).catch(() => {
        setInProgress(false)
      })
      if (!ffmpegResult) return

      const url = URL.createObjectURL(new Blob([ffmpegResult!.buffer]))
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `${video.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '')}.${container.value}`,
      );
      // Append to html link element page
      document.body.appendChild(link);

      // Start download
      link.click();

      // Clean up and remove the link
      link.remove();

      // Reset progress bar
      setInProgress(false)
    }}
  >
    {video && bg && <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '.5rem' }}>
      {/* height should be relative to thumb width to make it 16x9 */}
      <ModalTopBox bg={bg} video={video} />
      <div style={{
        width: '100%',
        gap: 0,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        margin: 'auto',
      }}>
        {videoStreams.length > 0 && audioStreams.length > 0 &&
          (<><div style={{ flex: 1, minWidth: 179 }}>
            <Typography.Text style={{ fontSize: '.8rem' }}>Video{!videoStreamSizeBytes ? '' : ` | ${humanFileSize(videoStreamSizeBytes)}`}</Typography.Text>
            <Select value={videoStream || videoStreams[1].value} options={videoStreams} style={{ width: '100%' }} onChange={setVideoStream} />
          </div>
            <div style={{ flex: 1, minWidth: 179 }}>
              <Typography.Text style={{ fontSize: '.8rem' }}>Audio{!audioStreamSizeBytes ? '' : ` | ${humanFileSize(audioStreamSizeBytes)}`}</Typography.Text>
              <Select value={audioStream || audioStreams[1].value} options={audioStreams} style={{ width: '100%' }} onChange={setAudioStream} />
            </div></>)}
        <div style={{ flex: 1, minWidth: 179 }}>
          <Typography.Text style={{ fontSize: '.8rem' }}>Container - <span onClick={() => { setContainerIsString(old => !old) }} style={{ textDecoration: 'underline', cursor: 'pointer', userSelect: 'none' }}>switch to {containerIsString ? "normal" : "custom"}</span></Typography.Text>
          <AnimatePresence>
            {!containerIsString && (<motion.div
              initial={{
                opacity: 0,
              }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
            ><Select value={container?.value} options={availableContainers.map((container) => {
              return {
                label: container.value,
                value: container.value,
              }
            })} style={{ width: '100%' }} onChange={(e: string) => {
              setContainer(containers.find((c) => c.value === e)!)
            }} /></motion.div>)}
            {containerIsString && (<motion.div
              initial={{
                opacity: 0,
              }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
            ><Input value={container?.value} style={{ width: '100%' }} onChange={(e) => setContainer({ value: e.currentTarget.value, type: undefined })} defaultValue={availableContainers[0].value} /></motion.div>)}
            <AnimatePresence key="AudioMetadataEditor">
              {false && (videoStream === "off" && audioStream !== "off" && video?.category === "Music") && (<motion.div
                style={{
                  overflow: 'hidden',
                  marginBottom: '.5rem',
                }}
                initial={{
                  height: 0,
                }}
                animate={{
                  height: 'auto',
                }}
                exit={{
                  height: 0,
                }}
              >
                <Divider orientation="left" style={{
                  margin: '.5rem 0',
                }}><Typography.Text>Audio Metadata</Typography.Text></Divider>
                <div style={{
                  width: '100%',
                  gap: '.5rem',
                  marginBottom: '.5rem',
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
                >
                  <div
                    style={{
                      borderRadius: 10,
                      overflow: 'hidden',
                      width: 100,
                      position: 'relative',
                      height: 100,
                    }}>
                    <input onChange={handleAlbumArtUpload} id="metadataAlbumArt" type="file" style={{ display: 'none' }} />
                    <Image quality={50} draggable={false} style={{
                      objectFit: 'cover',
                      width: 100,
                      height: 100,
                    }} src={metadataAlbumArt ? URL.createObjectURL(new Blob([metadataAlbumArt!])) : URL.createObjectURL(bg)} width={320} height={320} alt={`${metadataAlbum} album cover`} />
                    <div
                      className="display-on-hover"
                      id="metadataAlbumArtOverlay"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        background: 'rgba(0,0,0,.6)',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                        onClick={() => {
                          (document.querySelector("#metadataAlbumArt") as HTMLInputElement)?.click()
                        }}>
                        <IconUpload color="white" size={25} />
                      </div>
                      <div style={{
                        flex: 1,
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderTop: '1px solid rgba(255, 255, 255, .2)',
                        borderRadius: 25,
                      }}>
                        <div
                          style={{
                            flex: 1,
                            height: '100%',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            borderRadius: 25,
                          }}
                          onClick={() => refreshCover()}>
                          <IconSearch color="white" size={25} />
                        </div>
                        <AnimatePresence>
                          {(metadataAlbumArt) && <motion.div
                            initial={{
                              opacity: 0,
                            }}
                            animate={{
                              opacity: 1,
                            }}
                            exit={{
                              opacity: 0,
                            }}
                            style={{
                              flex: 1,
                              height: '100%',
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              borderLeft: '1px solid rgba(255, 255, 255, .2)',
                            }}
                            onClick={() => {
                              setMetadataAlbumArt(undefined)
                            }}>
                            <IconTrashX color="white" size={25} />
                          </motion.div>}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography.Text style={{ fontSize: '1.2rem', width: 'fit-content' }}>
                      <span
                        style={{ cursor: 'text' }}
                        onClick={() => (document.querySelector("input#metadataTitle") as HTMLInputElement)?.focus()}
                      >{metadataTitle}</span>
                    </Typography.Text>
                    <Typography.Text style={{ fontSize: '.8rem', width: 'fit-content', whiteSpace: 'pre-wrap' }}>
                      <span style={{ cursor: 'text' }} onClick={() => (document.querySelector("input#metadataArtist") as HTMLInputElement)?.focus()}>{metadataArtist}</span>
                      <span> - </span>
                      <span style={{ cursor: 'text' }} onClick={() => (document.querySelector("input#metadataAlbum") as HTMLInputElement)?.focus()}>{metadataAlbum || metadataTitle}</span>
                      <span> </span>
                      <span style={{ cursor: 'text' }} onClick={() => (document.querySelector("input#metadataDate") as HTMLInputElement)?.focus()}>({metadataDate})</span>
                    </Typography.Text>
                  </div>
                </div>
                <div style={{
                  width: '100%',
                  gap: 0,
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  margin: 'auto',
                }}>
                  <div style={{ flex: 1, minWidth: 179 }}>
                    <Typography.Text style={{ fontSize: '.8rem' }}>Title</Typography.Text>
                    <Input
                      id="metadataTitle"
                      value={metadataTitle}
                      onChange={(e) => setMetadataTitle(e.currentTarget.value)}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 179 }}>
                    <Typography.Text style={{ fontSize: '.8rem' }}>Artist</Typography.Text>
                    <Input
                      id="metadataArtist"
                      value={metadataArtist}
                      onChange={(e) => setMetadataArtist(e.currentTarget.value)}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 179 }}>
                    <Typography.Text style={{ fontSize: '.8rem' }}>Album</Typography.Text>
                    <Input
                      id="metadataAlbum"
                      value={metadataAlbum}
                      onChange={(e) => setMetadataAlbum(e.currentTarget.value)}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 179 }}>
                    <Typography.Text style={{ fontSize: '.8rem' }}>Date</Typography.Text>
                    <Input
                      id="metadataDate"
                      type="number"
                      value={metadataDate}
                      onChange={(e) => setMetadataDate(parseInt(e.currentTarget.value))}
                    />
                  </div>
                </div>
              </motion.div>)}
            </AnimatePresence>
            <div key="dlEst" style={{
              display: 'flex',
              justifyContent: 'right',
            }}>
              <Typography.Text>
                Estimated download time: {(streamSizesReady) ? Math.round(estimatedDownloadTimeSeconds) : '??'} seconds
              </Typography.Text>
            </div>
          </AnimatePresence>
        </div>
      </div>
    </div>
    }
  </Modal>
}

export async function getServerSideProps(context: any) {
  context.res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  context.res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  let videoID: string = ""
  if (context.query["v"]) {
    videoID = context.query["v"]
  }

  try {
    return {
      props: {
        videoID,
        videoDataPreload: videoID ? await apiCall("GET", `${PIPED}/streams/${videoID}`) : null,
      },
    };
  } catch (err) {
    return {
      props: {
        videoID,
        videoDataPreload: null,
      },
    };
  }
}

export default Home