// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import ffmpeg from 'fluent-ffmpeg'
import { createReadStream, unlink, unlinkSync } from 'fs'

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<any>
) {
    const id = (new Date()).getTime()
    const proc = ffmpeg()
    const rb: {
        videoStream: string
        audioStream: string
        container: string
    } = req.body
    if (!rb.videoStream && !rb.audioStream) {
        res.status(400).json({ error: 'No video or audio stream provided' })
        return
    }
    if (!rb.container) {
        res.status(400).json({ error: 'No container provided' })
        return
    }
    if (rb.videoStream) proc.input(rb.videoStream)
    if (rb.audioStream) proc.input(rb.audioStream)
    proc.outputOptions('-movflags frag_keyframe+empty_moov')
    if (rb.videoStream && rb.audioStream) {
        proc.outputOptions('-map 0:v:0')
        proc.outputOptions('-map 1:a:0')
    } else if (rb.audioStream) {
        proc.outputOptions('-map 0:a:0')
    } else if (rb.videoStream) {
        proc.outputOptions('-map 0:v:0')
    }
    proc.outputOptions('-shortest')
    proc.outputOptions('-f ' + rb.container.toLowerCase())
    proc.outputOptions('-')
    proc.on('error', (err) => {
        console.log('An error occurred: ' + err.message)
        res.status(500).json({ error: err.message })
    })
    proc.on('end', () => {
        const stream = createReadStream(`./tmp/${id}.${rb.container.toLowerCase()}`)
        stream.on('end', () => {
            setTimeout(() => {
                stream.close()
                unlinkSync(`./tmp/${id}.${rb.container.toLowerCase()}`)
                res.end()
            }, 1000)
        })
        stream.pipe(res)
    })
    proc.on('progress', (progress) => {
        console.log('Processing: ' + progress.percent + '% done')
    })
    proc.on('stderr', (stderrLine) => {
        console.log('Stderr output: ' + stderrLine)
    })
    proc.on('start', (commandLine) => {
        console.log('Spawned Ffmpeg with command: ' + commandLine)
    })
    proc.save(`./tmp/${id}.${rb.container.toLowerCase()}`)
    proc.run()
}
