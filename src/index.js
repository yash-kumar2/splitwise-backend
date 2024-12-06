const express = require('express')
require('./db/mongoose')
const userRouter = require('./routers/user')
const groupRouter = require('./routers/group')
const expenseRouter = require('./routers/expense')
const cors=require('cors')

const app = express()
const port = process.env.PORT || 3000
app.use(cors());
app.options('*', cors());


app.use(express.json())
app.use(userRouter)
app.use(groupRouter)
app.use(expenseRouter)

app.listen(port, () => {
    console.log('Server is up on port ' + port)
})


