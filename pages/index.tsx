import type { NextPage } from "next"
import { Input, Typography, Modal, Select, Spin, notification } from "antd";
import { motion, AnimatePresence } from "framer-motion"
import { useCallback, useEffect, useState } from "react";
import { getVideoIDFromURL } from "@/components/strings"
import { apiCall, getHost } from "@/components/api"
import Image from "next/image"
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { IconCheck, IconDeviceMobileOff, IconMovie, IconX } from "@tabler/icons-react"
import Head from "next/head"
import axios, { AxiosResponse, CancelTokenSource, Canceler } from "axios";

const PIPED = "https://api-piped.mha.fi"

const videoDisallowedITags: Array<number> = []
const audioDisallowedITags: Array<number> = []

const containers = [
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
    value: "mov",
    type: "video"
  },
  {
    value: "avi",
    type: "video"
  }
]

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

const fetchWithProgress = async (url: string, params?: { timeout?: number, timeoutCallback?: () => void, progressCallback?: (progress: number) => void }): Promise<Uint8Array | undefined> => {
  const source = axios.CancelToken.source();

  try {
    const response: AxiosResponse = await axios.get(url, {
      responseType: "blob",
      cancelToken: source.token,
      onDownloadProgress: (progressEvent) => {
        const currentProgress = Math.floor((progressEvent.loaded / progressEvent.total!) * 100);
        if (params?.progressCallback) params.progressCallback(currentProgress);
      },
    });

    const blob = response.data;
    const result = await blobToArrayBuffer(blob);

    return result;
  } catch (error) {
    if (axios.isCancel(error)) {
      // Request was canceled
      console.log("Request canceled", error);
    } else {
      // Other error occurred
      console.log("Error occurred", error);
    }

    return
  }
};

const Home: NextPage = () => {
  const [video, setVideo] = useState<any>(undefined)
  const [videoID, setVideoID] = useState<string | undefined>(undefined)
  const [bg, setBg] = useState<any>(undefined)
  const [query, setQuery] = useState<string>("")
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [videoStream, setVideoStream] = useState<string | undefined>()
  const [audioStream, setAudioStream] = useState<string | undefined>()
  const [container, setContainer] = useState<string>("mp4")
  const [notifications, contextHolder] = notification.useNotification();
  const [inProgress, setInProgress] = useState<boolean>(false)
  const [ffmpeg, setFFmpeg] = useState<FFmpeg | undefined>(undefined)
  const [dlProgress, setDlProgress] = useState<{ video: number, audio: number }>({ video: 0, audio: 0 })
  const [ffmpegReady, setFFmpegReady] = useState<boolean>(false)
  const dlProgressAvg = weightedPercentage({ weight: videoStream !== 'off' ? 0.7 : 0, value: dlProgress.video }, { weight: audioStream !== 'off' ? 0.3 : 0, value: dlProgress.audio })

  useEffect(() => {
    if (!ffmpeg) {
      setFFmpeg(createFFmpeg({
        log: true,
        corePath: `${process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://ytdl.shie1bi.hu"}/ffmpeg-core.js`
      }))
    }
  }, [ffmpeg])

  useEffect(() => {
    if (!inProgress) setDlProgress({ video: 0, audio: 0 })
  }, [inProgress])

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

  useEffect(() => {
    if (ffmpeg && !ffmpegReady) { ffmpeg.load(); setFFmpegReady(true) }
  }, [ffmpeg, ffmpegReady])

  const ready = video && bg

  const videoStreams = !video ? [] : [{
    label: 'No Video',
    value: "off"
  }, ...video.videoStreams.filter((stream: any) =>
    stream.mimeType.startsWith("video") && stream.quality.search("p") > -1 && !videoDisallowedITags.includes(stream.itag)
  ).map((stream: any) => {
    return {
      label: `${stream.quality} (${stream.mimeType})`,
      value: stream.url
    }
  }).sort((a: any, b: any) => {
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
  })]

  const audioStreams = !video ? [] : [{
    label: 'No Audio',
    value: "off"
  }, ...video.audioStreams.filter((stream: any) =>
    stream.mimeType.startsWith("audio") && !audioDisallowedITags.includes(stream.itag) && stream.mimeType.split("/")[1] !== "webm"
  ).map((stream: any) => {
    return {
      label: `${stream.quality} (${stream.mimeType})`,
      value: stream.url
    }
  }).sort((a: any, b: any) => {
    const aq = a.label.split(' ')[0]
    const bq = b.label.split(' ')[0]
    return parseInt(bq) - parseInt(aq)
  })]

  // if only video, then video containers, if only audio, then audio containers, if both, then video containers, if none, then none
  // ignore videostreams and audiostreams, just use the container
  const availableContainers = !video ? [] : containers.filter((c) => {
    if (audioStream === "off" && videoStream === "off") {
      return false
    } else if (audioStream !== "off" && videoStream !== "off") {
      if (c.type === "video") {
        return true
      }
    } else {
      if (c.type === "video" && videoStream !== "off") {
        return true
      }
      if (c.type === "audio" && audioStream !== "off") {
        return true
      }
    }
    return false
  }).map((c) => c.value)

  useEffect(() => {
    if (!availableContainers.includes(container)) setContainer(availableContainers[0])
  }, [availableContainers])

  useEffect(() => {
    setVideoID(undefined); setVideo(undefined); setBg(undefined); setVideoStream(undefined); setAudioStream(undefined); setContainer("mp4")
    const id = getVideoIDFromURL(query)
    if (!query || !id) { return }
    setVideoID(id)
  }, [query])

  useEffect(() => {
    if (!videoID) return
    apiCall("GET", `${PIPED}/streams/${videoID}`).then((res) => {
      setVideo(res)
    })
  }, [videoID])

  useEffect(() => {
    if (!video) return
    fetch(video.thumbnailUrl).then((res: any) => {
      return res.blob()
    }).then((blob) => {
      setBg(URL.createObjectURL(blob))
    })
  }, [video])

  return <>
    <Head>
      <title>Shibi-YTDL</title>
    </Head>
    {contextHolder}
    <motion.div id="inner" style={{
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
      width: '100%',
      position: 'relative',
    }}>
      <AnimatePresence>
        {ready &&
          <motion.div
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
            style={{ backgroundImage: `url("${bg}")` }}
            className="bg" />}
        {(inProgress) &&
          <motion.div
            initial={{
              width: `${100 - dlProgressAvg}%`,
              opacity: 0
            }}
            animate={{
              width: `${100 - dlProgressAvg}%`,
              opacity: 1
            }}
            exit={{
              width: `${100 - dlProgressAvg}%`,
              opacity: 0
            }}
            className="bg-filter" />
        }
      </AnimatePresence>
      <div>
        <Typography.Title style={{ fontSize: '4rem', margin: 0 }} className="center horizontal vertical">
          /Shibi-YTDL/
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
          {ready && <>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              style={{ overflow: 'hidden', marginBottom: '0.5rem' }}
            >
              <Image draggable={false} alt={video.title} src={bg} width={1280} height={720} style={{ objectFit: 'contain', height: '26dvh', maxHeight: '50vmin', width: 'auto', marginBottom: '.5rem', borderRadius: 10 }} />
              <Typography.Title style={{ fontSize: '1.8rem', textOverflow: 'ellipsis', overflow: 'hidden', width: '100%', margin: 0, lineClamp: 2, WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: 'vertical' }} className="center horizontal vertical">{video.title}</Typography.Title>
              <Typography.Text style={{ fontSize: '1rem' }} className="center horizontal vertical">{video.uploader}</Typography.Text>
            </motion.div>
          </>}
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
        <Modal
          title="Download video"
          open={modalOpen && ready}
          onCancel={() => setModalOpen(false)}
          onOk={async () => {
            if (!ffmpeg) return
            const conversionId = (new Date()).getTime()
            setModalOpen(false)
            setInProgress(true)
            notifications.open({
              message: "Downloading video and audio streams...",
              description: 'This may take a while depending on the length and quality of the video and your internet connection',
              duration: 0,
              placement: 'bottomRight',
              key: 'download',
              className: 'noclose',
              icon: <Spin />,
            })
            const vStreamUrl = videoStream === "off" ? undefined : videoStream || videoStreams[1].value
            const aStreamUrl = audioStream === "off" ? undefined : audioStream || audioStreams[1].value
            console.log(`Started #${conversionId}`, { vStreamUrl, aStreamUrl, container })
            let vStreamFile
            let aStreamFile

            if (vStreamUrl) {
              vStreamFile = await fetchWithProgress(vStreamUrl, {
                progressCallback: (progress) => {
                  setDlProgress((prev) => {
                    if (!prev) return { video: progress, audio: 0 }
                    return { ...prev, video: progress }
                  })
                },
                timeoutCallback: () => {
                  notifications.error({
                    message: 'Download timed out!',
                    description: 'Please check your network connection',
                    placement: 'bottomRight',
                    key: 'download',
                    icon: <IconX />,
                    duration: 4.5,
                  })
                }
              });
              if (vStreamFile) ffmpeg.FS("writeFile", `video-${conversionId}`, vStreamFile)
            }

            if (aStreamUrl) {
              aStreamFile = await fetchWithProgress(aStreamUrl, {
                progressCallback: (progress) => {
                  setDlProgress((prev) => {
                    if (!prev) return { video: 0, audio: progress }
                    return { ...prev, audio: progress }
                  })
                },
                timeoutCallback: () => {
                  notifications.error({
                    message: 'Download timed out!',
                    description: 'Please check your network connection',
                    placement: 'bottomRight',
                    key: 'download',
                    icon: <IconX />,
                    duration: 4.5,
                  })
                }
              });
              if (aStreamFile) ffmpeg.FS("writeFile", `audio-${conversionId}`, aStreamFile)
            }

            if ((vStreamUrl && !vStreamFile) || (aStreamUrl && !aStreamFile)) { setInProgress(false); return } // if timeout return

            const videoS = !vStreamUrl ? '' : ` -i video-${conversionId}`
            const audioS = !aStreamUrl ? '' : ` -i audio-${conversionId}`
            let map = ""
            if (vStreamUrl && aStreamUrl) {
              map = ' -map 0:v:0 -map 1:a:0 -shortest -c:v copy -c:a copy'
            }
            const command = `-y${videoS}${audioS}${map} -f ${container} output-${conversionId}.${container}`
            console.log(command)
            notifications.open({
              message: 'Merging video and audio streams...',
              description: `Using your hardware to merge the streams.`,
              duration: 0,
              placement: 'bottomRight',
              key: 'download',
              className: 'noclose',
              icon: <IconMovie />,
            })
            await ffmpeg.run(...command.split(' '))
            setInProgress(false)
            try {
              const data = ffmpeg.FS('readFile', `output-${conversionId}.${container}`)
              notifications.success({
                message: 'Conversion complete!',
                description: 'Your video has been converted. The download should start shortly.',
                placement: 'bottomRight',
                key: 'download',
                duration: 4.5,
                icon: <IconCheck />
              })
              const mediaType = videoStream != "off" && audioStream != 'off' ? 'video' : 'audio'
              const url = URL.createObjectURL(new Blob([data.buffer], { type: `${mediaType}/${container}` }))
              const link = document.createElement('a');
              link.href = url;
              link.setAttribute(
                'download',
                `${video.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '')}.${container}`,
              );
              // Append to html link element page
              document.body.appendChild(link);

              // Start download
              link.click();

              // Clean up and remove the link
              link.remove();
            } catch (err) {
              notifications.error({
                message: 'Conversion failed.',
                description: 'Please try again with different settings.',
                placement: 'bottomRight',
                key: 'download',
                icon: <IconX />,
                duration: 4.5,
              })
              console.error(err)
            } finally {
              console.log("End of process // #" + conversionId)
            }
          }}
        >
          {video && <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '.5rem' }}>
            {/* height should be relative to thumb width to make it 16x9 */}
            <div style={{
              display: 'flex',
              width: '100%',
              height: 200,
              flexDirection: 'row',
              alignItems: 'end',
              position: 'relative',
              backgroundImage: `url("${bg}")`,
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
                <Typography.Text style={{ fontSize: '.8rem' }}>Video</Typography.Text>
                <Select value={videoStream || videoStreams[1].value} options={videoStreams} style={{ width: '100%' }} onChange={setVideoStream} />
              </div>
              <div style={{ flex: 1, minWidth: 179 }}>
                <Typography.Text style={{ fontSize: '.8rem' }}>Audio</Typography.Text>
                <Select value={audioStream || audioStreams[1].value} options={audioStreams} style={{ width: '100%' }} onChange={setAudioStream} />
              </div>
              <div style={{ flex: 1, minWidth: 179 }}>
                <Typography.Text style={{ fontSize: '.8rem' }}>Container</Typography.Text>
                <Select value={container} options={availableContainers.map((container) => {
                  return {
                    label: container,
                    value: container
                  }
                })} style={{ width: '100%' }} onChange={setContainer} defaultValue={availableContainers[0]} />
              </div>
            </div>
          </div>}
        </Modal>
      </div >
      <div className="center horizontal vertical">
        <Typography.Text style={{ fontSize: '1rem' }}>
          Made with Next.js, Ant Design, Framer Motion, Piped and FFmpeg{"(WASM)"}.
        </Typography.Text>
      </div>
    </motion.div >
  </>;
}

export async function getServerSideProps(context: any) {
  context.res.setHeader('Cache-Control', 'no-store');
  context.res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  context.res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  return {
    props: {},
  };
}

export default Home