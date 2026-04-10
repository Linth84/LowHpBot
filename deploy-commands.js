import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  
  new SlashCommandBuilder()
    .setName("ventilar")
    .setDescription("Hablar en privado con LowHP Bot"),

  new SlashCommandBuilder()
    .setName("vent")
    .setDescription("Talk privately with LowHP Bot"),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  const clientId = process.env.CLIENT_ID;

  await rest.put(
    Routes.applicationCommands(clientId), // ✅ GLOBAL
    { body: commands }
  );

  console.log("✅ Comandos globales registrados");
}

main().catch(console.error);