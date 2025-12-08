
// // // via cloud mongodb
// const mongoose=require('mongoose');
// mongoose.connect('mongodb+srv://mrakhaauliya_db_user:G5cLAeRd3Xh2sXmk@cluster0.garqogf.mongodb.net/cameras', {
//     useNewUrlParser: true,
//     useUnifiedTopology:true,
//     useCreateIndex:true
// });
import mongoose from 'mongoose';

const connectDB = async () => {
  try {
      await mongoose.connect('mongodb://127.0.0.1:27017/cameras', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully!');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1); // hentikan server jika gagal
  }
};

export default connectDB;

