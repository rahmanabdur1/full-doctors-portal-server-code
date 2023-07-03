const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const stripe = require("stripe")(process.env.STRIPE_KEY)
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

function sendBookingEmail(booking) {
  const { email, treatment, appointmentDate, slot } = booking;
  const auth = {
    auth: {
      api_key: process.env.EMAIL_SEND_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN
    }
  }

  const transporter = nodemailer.createTransport(mg(auth));


  transporter.sendMail({
    from: "rahmanboksi11@gmail.com",
    to: email || "rahmanboksi11@gmail.com", // recipient email
    subject: `Your appointment for ${treatment} is confirmed`, // Subject line
    text: "Hello world!", // plain text body
    html: `
  <h3> Your appointment is confirmed </h3>
  <div>
  <p>Your appointment for treatment :${treatment}</p>
  <p>Please visit us on ${appointmentDate} at ${slot}</p>
  <p>Thanks from Doctors Portal.
  </div>
  `

  }, function (error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info);
    }
  });

}




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
    const appointmentOptionsCollection = client.db("doctors-portal").collection("appointmentCollection");
    const bookingCollactions = client.db("doctors-portal").collection("bookingCollaction");
    const usersCollactions = client.db("doctors-portal").collection("usersCollaction")
    const doctorsCollactions = client.db("doctors-portal").collection("doctorsCollactions");
    const paymentCollection = client.db("doctors-portal").collection("paymentCollection");
    const contactCollection = client.db("doctors-portal").collection("contactCollection");

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail }
      const user = await usersCollactions.findOne(query);

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });

      }
      next();
    }


    app.post('/contact', async (req, res) => {
      const contact = req.body;
      const result = await contactCollection.insertOne(contact);
      res.send(result)
    })




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



    app.get('/v2/appointmentOptions', async (req, res) => {
      const date = req.query.data;
      const options = await appointmentOptionsCollection.aggregate([
        {
          $lookup: {
            from: 'bookingCollaction',
            localField: 'name',
            foreignFeild: 'treatment',
            pieline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$appointmentDate', date],
                  }
                }
              }
            ],
            as: 'booked'
          }
        },
        {
          $project: {
            name: 1,
            slots: 1,
            price:1,
            booked: {
              $map: {
                input: '$booked',
                as: 'book',
                in: '$$book.slot'
              }
            }
          }
        },
        {
          $project: {
            name: 1,
            price:1,
            slots: {
              setDifference: ['$slots', '$booked']
            }
          }
        }
      ]).toArray();
      res.send(options)
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


    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      console.log('..', id);
      const query = { _id: new ObjectId(id) };
      const booking = await bookingCollactions.findOne(query);
      res.send(booking);
    });


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
      sendBookingEmail(booking)
      res.send(result)
    })


    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({

        amount: amount,
        currency: "usd",
        "payment_method_types": [
          "card"
        ]
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
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

    app.get('/appointmentSpecialty', async (req, res) => {
      const query = {}
      const result = await appointmentOptionsCollection.find(query).project({ name: 1 }).toArray()
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

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await usersCollactions.findOne(query)
      res.send({ isAdmin: user?.role === 'admin' })
    })


    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

      const id = req.params.id;
      console.log('kng', id)
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

    // app.get('/addPrice', async(req, res)=>{
    //   const filter ={};
    //   const options ={upsert: true};
    //   const updatedDoc ={
    //     $set:{
    //       price: {
    //         $each: [77, 77, 88, 99, 55, 44],
    //       },
    //     }
    //   };
    //   const result =await appointmentOptionsCollection.updateMany(filter, updatedDoc,options);
    //   res.send(result)
    // })

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorsCollactions.find(query).toArray();
      res.send(result);
    })

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const result = await doctorsCollactions.deleteOne(filter);
      res.send(result)
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollactions.insertOne(doctor);
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

