import mongoose from "mongoose";

const StreamingSchema = new mongoose.Schema({
  name: String,
  location: String,
  userId: String,
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }]
});

export default mongoose.model("Streaming", StreamingSchema);
