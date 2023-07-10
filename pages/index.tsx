import type { NextPage } from "next"
import { Input, Typography, Modal, Select, Space, Switch } from "antd"
import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useRef, useState } from "react"
import { getVideoIDFromURL } from "@/components/strings"
import { apiCall } from "@/components/api"
import Image from "next/image"

const Home: NextPage = () => {
  const [video, setVideo] = useState<any>(undefined)
  const [videoID, setVideoID] = useState<string | undefined>(undefined)
  const [bg, setBg] = useState<any>(undefined)
  const [query, setQuery] = useState<string>("")
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [videoStream, setVideoStream] = useState<string>("")
  const ready = video && bg

  const videoStreams = !video ? [] : [{
    label: 'No Video',
    value: ""
  }, ...video.videoStreams.filter((stream: any) =>
    stream.mimeType.startsWith("video") && !stream.quality.startsWith("LBRY")
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
    value: ""
  }, ...video.audioStreams.filter((stream: any) =>
    stream.mimeType.startsWith("audio")
  ).map((stream: any) => {
    return {
      label: `${stream.quality} (${stream.mimeType})`,
      value: stream.url
    }
  })]

  useEffect(() => {
    setVideoID(undefined); setVideo(undefined); setBg(undefined)
    const id = getVideoIDFromURL(query)
    if (!query || !id) { return }
    setVideoID(id)
  }, [query])

  useEffect(() => {
    if (!videoID) return
    apiCall("GET", `https://pipedapi.kavin.rocks/streams/${videoID}`).then((res) => {
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

  return (<>
    <motion.div id="inner" style={{
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
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
            onAnimationComplete={() => {
              console.log("animation complete")
            }}
            style={{ backgroundImage: `url("${bg}")` }}
            className="bg" />}
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
              <Image alt={video.title} src={bg} width={1280} height={720} style={{ objectFit: 'contain', height: '20dvh', width: 'auto', marginBottom: '.5rem', borderRadius: 5 }} />
              <Typography.Title style={{ fontSize: '2rem', margin: 0 }} className="center horizontal vertical">{video.title}</Typography.Title>
              <Typography.Text style={{ fontSize: '1rem' }} className="center horizontal vertical">{video.uploader}</Typography.Text>
            </motion.div>
          </>}
        </AnimatePresence>
        <Input.Search loading={query.length !== 0 && !ready} value={query} onSearch={() => setModalOpen(true)} onChange={(e) => {
          setQuery(e.target.value)
        }} placeholder="https://youtu.be/dQw4w9WgXcQ" enterButton="Download" style={{ width: '100%' }} size="large" />
        <Modal
          title="Download video"
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={() => setModalOpen(false)}
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
            }}>
              <div style={{ background: 'rgba(0,0,0,.7)', padding: '.2rem', display: 'flex', flexDirection: 'column', width: '100%' }}>
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
                <Select options={videoStreams} style={{ width: '100%' }} onChange={setVideoStream} defaultValue={videoStreams[1].value} />
              </div>
              <div style={{ flex: 1, minWidth: 179 }}>
                <Typography.Text style={{ fontSize: '.8rem' }}>Audio</Typography.Text>
                <Select options={audioStreams} style={{ width: '100%' }} onChange={setVideoStream} defaultValue={audioStreams[1].value} />
              </div>
            </div>
          </div>}
        </Modal>
      </div >
      <div className="center horizontal vertical">
        <Typography.Text style={{ fontSize: '1rem' }}>
          Made with Next.js, Ant Design, Framer Motion, Piped and a no-bullshit mentality.
        </Typography.Text>
      </div>
    </motion.div >
  </>)
}

export default Home