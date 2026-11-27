// Shared utterance fixtures for inventory understanding tests (not real household data).

export const UPDATE_CASES = [
  ["I have put small picture hooks into the cupboard upstairs into the X box", "Small picture hooks", "a", "Cupboard upstairs › X box", "plenty"],
  ["I put the hooks back in the kitchen drawer, we've only got a couple left", "Small picture hooks", "a", "Kitchen drawer", "low"],
  ["Put the picture hooks here, we've got loads", "Small picture hooks", "a", "", "plenty"],
  ["I've put the small picture hooks in the upstairs cupboard in the X box", "Small picture hooks", "a", "Cupboard upstairs › X box", "plenty"],
  ["We've run out of bin bags", "Bin bags", "d", "Under the sink", "out"],
  ["Running low on AA batteries", "AA batteries", "c", "Kitchen drawer", "low"],
  ["The light bulbs are in the hall cupboard on the top shelf", "Light bulbs", "e", "Hall cupboard › Top shelf", "plenty"],
  ["Moved the superglue from the kitchen drawer to the garage toolbox", "Superglue", "g", "Garage › Toolbox", "plenty"],
  ["Put the nappies back, only 3 left", "Nappies", "f", "Nursery › Changing unit", "low"],
  ["I've put a new box of screws in the garage on the shelf", "Screws", null, "Garage › Shelf", "plenty"],
  ["Batteries are finished", "AA batteries", "c", "Kitchen drawer", "out"],
  ["Put the wrapping paper under the bed in the spare room, loads left", "Wrapping paper", null, "Spare room › Under the bed", "plenty"],
  ["I've put them in the loft", "Light bulbs", "e", "Loft", "plenty"],
  ["Um, so I put the Calpol on top of the fridge, we're nearly out", "Calpol", null, "On top of the fridge", "low"],
  ["Stashed the spare keys behind the clock in the hall", "Spare keys", null, "Hall › Behind the clock", "plenty"],
  ["Picture hooks back in the X box", "Small picture hooks", "a", "Cupboard upstairs › X box", "plenty"],
  ["I put the coat hooks upstairs, there's plenty", "Coat hooks", "b", "Upstairs", "plenty"],
  ["We need more bin bags", "Bin bags", "d", "Under the sink", "low"],
  ["Sellotape's in the office drawer, we've got loads", "Sellotape", null, "Office drawer", "plenty"],
  ["Used the last of the light bulbs", "Light bulbs", "e", "Hall cupboard", "out"],
];