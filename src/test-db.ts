import prisma from './lib/prisma';

async function runTest() {
  console.log("⏳ Connecting to Supabase...");
  try {
    const user = await prisma.user.create({
      data: {
        email: `tester_${Date.now()}@test.com`,
        name: "Initial Test User"
      }
    });
    console.log("✅ Success! User created:", user);
  } catch (err) {
    console.error("❌ Connection failed. Check your .env file location.");
  } finally {
    await prisma.$disconnect();
  }
}

runTest();