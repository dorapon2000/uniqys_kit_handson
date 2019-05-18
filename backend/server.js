const express = require("express")
const bodyParser = require("body-parser")
const Memcached = require("memcached")
const keccak = require('keccak') // ファイルの一番上
const axios = require('axios') // ファイルの一番上

const APP_HOST = '0.0.0.0'  // backendサーバが動作するホスト名
const APP_PORT = 5650       // backendサーバが動作するポート番号
const DB_HOST = 'localhost' // inner memcachedのホスト名
const DB_PORT = 5652        // inner memcachedのポート番号

const INNER_API_HOST = 'localhost'
const INNER_API_PORT = 5651

const OPERATOR_ADDRESS = 'b8e6493bf64cae685095b162c4a4ee0645cde586'


const app = express() // expressを使う準備
app.use(bodyParser())
app.use('/', express.static('frontend/dist'))

const memcached = new Memcached(`${DB_HOST}:${DB_PORT}`) // memcached apiを使う準備

/* ここにサーバの内容を書いていく */

// カウンターを増やす
async function incrCount () {
    return new Promise((resolve, reject) => {
        memcached.incr('count', 1, (err, result) => {
            if (err) return reject(err)
            if (typeof result === 'number') return resolve(result)
            memcached.set('count', 1, 0, (err) => {
                if (err) return reject(err)
                resolve(1)
            })
        })
    })
}

// 購入によって誰かのガリを増やしたり減らしたりする関数
async function transferGari(from, to, gari) {
    return new Promise(async (resolve) => {
        const uri = `http://${INNER_API_HOST}:${INNER_API_PORT}/accounts/${from}/transfer`
        await axios.post(uri, JSON.stringify({ to, value: parseInt(gari) }), { headers: { 'Content-Type': 'application/json' } })
        resolve()
    })
}

app.post('/api/generate', async (req, res) => {
    const sender = req.header('uniqys-sender')
    const timestamp = req.header('uniqys-timestamp')
    const blockhash = req.header('uniqys-blockhash')

    const count = await incrCount()
    const newSushi = {
        id: count,
        status: 'normal',
        price: 0,
        owner: sender,
        dna: keccak('keccak256').update(count.toString()).digest('hex'),
        timestamp: timestamp,
        blockhash: blockhash
    }
    
    await transferGari(sender, OPERATOR_ADDRESS, 100)

    memcached.set(`sushi:${count}`, newSushi, 0, (err) => {
        if (err) {
            res.status(400).send(err)
        }
        else {
            res.sendStatus(200)
        }
    })
})

// カウンターの数字を取得する
async function getCount () {
    return new Promise((resolve, reject) => {
        memcached.get('count', (err, result) => {
            if (err) return reject(err)
            if (typeof result === 'number') return resolve(result)
            resolve(0)
        })
    })
}
  
// sushiオブジェクトの配列を取得する
async function getSushiList (count) {
    return new Promise((resolve, reject) => {
        if (!count) return resolve([])
        const ids = new Array(count).fill(0).map((_, i) => i + 1)
        memcached.getMulti(ids.map(id => `sushi:${id}`), (err, results) => {
            if (err) return reject(err)
            resolve(ids.map(id => results[`sushi:${id}`]).reverse())
        })
    })
}
  
app.get('/api/sushiList', async (_, res) => {
    const count = await getCount()
    const sushiList = await getSushiList(count)
    res.send({ sushiList });
});

app.get('/api/gari', async (req, res) => {
    const { address } = req.query
    const uri = `http://${INNER_API_HOST}:${INNER_API_PORT}/accounts/${address}/balance`
    const response = await axios.get(uri)
    const balance = response.data[0]
    // const balance = getBalance(address)
    res.send({ balance })
})

app.post('/api/tap', async (req, res) => {
    const sender = req.header('uniqys-sender')
  
    const uri = `http://${INNER_API_HOST}:${INNER_API_PORT}/accounts/${sender}/balance`
    await axios.put(uri, JSON.stringify([1000]), { headers: { 'Content-Type': 'application/json' } })
    res.send()
})

app.post('/api/sell', async (req, res) => {
    const { sushi, price } = req.body
  
    const newSushi = Object.assign({}, sushi, {
        status: 'sell',
        price: price
    })
  
    memcached.set(`sushi:${sushi.id}`, newSushi, 0, (err) => {
        if (err) {
            res.status(400).send(err)
        }
        else {
            res.sendStatus(200)
        }
    })
})

app.post('/api/buy', async (req, res) => {
    const sender = req.header('uniqys-sender')
    const { sushi } = req.body

    const newSushi = Object.assign({}, sushi, {
        status: 'normal',
        owner: sender,
        price: 0
    })

    await memcached.set(`sushi:${sushi.id}`, newSushi, 0, (err) => {
        if (err) {
            res.status(400).send(err)
        }
        else {
            res.sendStatus(200)
        }
    })
    await transferGari(sender, sushi.owner, sushi.price)
    res.send()
})

app.listen(APP_PORT, APP_HOST) // listenを開始する