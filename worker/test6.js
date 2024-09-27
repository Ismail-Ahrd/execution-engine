const express = require('express');
const path = require('path');
const { execShellCommand, createUser, deleteUser, killProcessGroup } = require('./utils');
const app = express();

app.use(express.json());

app.post('/api/execute', async (req, res) => {
  const { code, language } = req.body;
  const execId = `exec_${Date.now()}`;  // Unique user ID

  let pgid;  // Process group ID to track

  try {
    // Step 1: Create a new user
    await createUser(execId);
    const userHomeDir = `/home/${execId}`;
    const tempDir = path.join(userHomeDir, 'temp', execId);

    // Create the temporary directory for this execution
    await execShellCommand(`sudo -u ${execId} mkdir -p ${tempDir}`);

    // Prepare the shell script content
    let scriptContent = `
      #!/bin/sh
      ulimit -u 100   # Limit number of processes to 100
      ulimit -v 500000   # Set virtual memory limit to 500 MB
      ulimit -m 500000   # Set physical memory limit to 500 MB
    `;

    // Add language-specific execution logic
    switch (language) {
      case 'java': {
        const className = 'Main';
        const javaFilePath = path.join(tempDir, `${className}.java`);

        // Java commands: Write code, compile, and run
        scriptContent += `
          echo '${code}' > ${javaFilePath}
          javac ${javaFilePath}
          java -cp ${tempDir} ${className}
        `;
        break;
      }

      case 'cpp': {
        const cppFilePath = path.join(tempDir, 'program.cpp');
        const executableFile = path.join(tempDir, 'program');

        // C++ commands: Write code, compile, and run
        scriptContent += `
          echo '${code}' > ${cppFilePath}
          g++ -o ${executableFile} ${cppFilePath}
          ${executableFile}
        `;
        break;
      }

      case 'javascript': {
        const jsFilePath = path.join(tempDir, 'script.js');

        // JavaScript commands: Write code and run
        await execShellCommand(`echo '${code}' | sudo -u ${execId} tee ${jsFilePath}`);
        scriptContent += `
          node ${jsFilePath}
        `;
        break;
      }

      default:
        throw new Error('Unsupported language');
    }

    // Write the script to a file
    const scriptPath = path.join(tempDir, 'execute.sh');
    await execShellCommand(`echo '${scriptContent}' | sudo -u ${execId} tee ${scriptPath}`);
    await execShellCommand(`sudo -u ${execId} chmod +x ${scriptPath}`);

    // Step 2: Execute the script in a new process group and get its PGID
    const pgidCommand = `sudo -u ${execId} setsid sh -c 'echo $$ > ${tempDir}/pgid && sudo -u ${execId} sh ${scriptPath}'`;
    const output = await execShellCommand(pgidCommand);

    // Step 3: Retrieve the process group ID (PGID)
    pgid = await execShellCommand(`cat ${tempDir}/pgid`);

    // Step 4: Capture the output of the script
    //const output = await execShellCommand(`sudo -u ${execId} sh ${scriptPath}`);

    // Return the output to the client
    res.json({ output });

  } catch (error) {
    console.error(error);

    // If error occurs, terminate the process group
    if (pgid) {
      await killProcessGroup(pgid);
    }

    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup - Delete the user and its files
    try {
      await deleteUser(execId);
    } catch (cleanupError) {
      console.error(`Cleanup error: ${cleanupError.message}`);
    }
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));





