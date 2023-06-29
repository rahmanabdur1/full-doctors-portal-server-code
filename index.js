const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require("jsonwebtoken")
const port = process.env.PORT || 5000;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.gzkpw83.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('unauthorize access')
  }
  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbidden' })
    }
    req.decoded = decoded;
    next();
  })

}

async function run() {
  try {
    const appointmentOptionsCollection = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingCollactions = client.db("doctorsPortal").collection("bookingCollactions");
    const usersCollactions = client.db("doctorsPortal").collection("usersCollactions")
    const doctorsCollactions=client.db("doctorsPortal").collection("doctorsCollaction");
    

    const verifyAdmin =async(req,res,next)=>{
      const decodedEmail =req.decoded.email;
      const query ={email: decodedEmail}
      const user =await usersCollactions.findOne(query);

      if(user?.role !== 'admin'){
        return res.status(403).send({message: 'forbidden access'});

      }
      next();
    }

    app.get('/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      const query = {}
      const options = await appointmentOptionsCollection.find(query).toArray()
      const bookingQuery = { appointmentDate: date };
      const alreadyBook = await bookingCollactions.find(bookingQuery).toArray();

      // code carefully
      options.forEach(option => {
        const optionBooked = alreadyBook.filter(book => book.treatment === option.name)
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots
        console.log(date, option.name, remainingSlots.length)
      })
      res.send(options);
    })


    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbiden' })
      }

      const query = { email: email };
      const bookings = await bookingCollactions.find(query).toArray();
      res.send(bookings)
    })


    app.post('/bookings', async (req, res) => {
      const booking = req.body

      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }

      const alreadyBook = await bookingCollactions.find(query).toArray()

      if (alreadyBook.length) {
        const message = `You already a booking now ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })
      }
      const result = await bookingCollactions.insertOne(booking);
      res.send(result)
    })

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollactions.findOne(query)

      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '2d' });
        return res.send({ accessToken: token })
      }
      console.log(user)
      res.status(403).send({ accessToken: '' })
    })

    app.get('/appointmentSpecialty', async(req, res)=>{
        const query ={}
        const result =await appointmentOptionsCollection.find(query).project({name:1}).toArray()
        res.send(result)
    })

    app.get('/users', async (req, res) => {

      const query = {};
      const users = await usersCollactions.find(query).toArray();
      res.send(users)
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollactions.insertOne(user);
      res.send(result)
    });
    
    app.get('/users/admin/:email',async (req,res)=>{
       const email= req.params.email;
       const query ={email}
       const user =await usersCollactions.findOne(query)
       res.send({isAdmin: user?.role === 'admin'})
    })

    app.put('/users/admin/:id', verifyJWT,verifyAdmin, async (req, res) => {
     
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollactions.updateOne(filter, updatedDoc, options);
      res.send(result);
    });

    app.get('/doctors',verifyJWT,verifyAdmin, async(req, res)=>{
      const query= {};
      const result =await doctorsCollactions.find(query).toArray();
      res.send(result);
    })
    
    app.delete('/doctors/:id',verifyJWT,verifyAdmin,  async(req,res)=>{
      const id=req.params.id;
      const filter={_id: new ObjectId(id)}
      const result =await doctorsCollactions.deleteOne(filter);
      res.send(result)
    })

    app.post('/doctors',verifyJWT,verifyAdmin, async(req, res)=>{
      const doctor =req.body;
      const result =await doctorsCollactions.insertOne(doctor);
      res.send(result);
    })
  } finally {


  }
}

run().catch(console.log);

app.get('/', async (req, res) => {
  res.send('Doctors portal server is running');
});

app.listen(port, () => console.log(`Doctors server listening on port ${port}`));

