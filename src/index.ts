import bcrypt from 'bcryptjs';
import express from 'express';
import cors from 'cors';
import prisma from './lib/prisma';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// --- 1. POST ROUTES ---

// GET ALL POSTS (Home Page - Now includes everything)
// GET ALL POSTS (The Home Page Route)
// GET SMART PERSONALIZED HOME FEED (WITH REVENUE INCLUDES)
// GET ALL POSTS (WITH USER-FILTER AND SORTING)
app.get('/api/posts', async (req, res) => {
  const { userEmail, sortBy } = req.query; // Accept userEmail and sortBy parameter

  // Determine dynamic Prisma sorting configuration
  let orderByCondition = { createdAt: 'desc' }; // Default fallback: Latest
  if (sortBy === 'popular') {
    orderByCondition = { votes: 'desc' }; // Sort by highest vote count
  }

  // Your complex include block to keep comment/author relationships intact
  const postDataIncludes = {
    author: true,
    community: true, 
    comments: {
      orderBy: { createdAt: 'desc' },
      include: { author: true }
    },
    _count: { select: { comments: true } }
  };

  try {
    // SCENARIO A: User is logged in, find their joined communities
    if (userEmail && userEmail !== 'undefined') {
      const userWithCommunities = await prisma.user.findUnique({
        where: { email: String(userEmail) },
        include: { communities: { select: { name: true } } }
      });

      if (userWithCommunities && userWithCommunities.communities.length > 0) {
        const joinedNames = userWithCommunities.communities.map(c => c.name);

        // Fetch posts ONLY from communities the user has joined, keeping all relationships
        const personalizedPosts = await prisma.post.findMany({
          where: {
            community: {
              name: { in: joinedNames }
            }
          },
          include: postDataIncludes,
          orderBy: orderByCondition // <--- APPLY DYNAMIC SORT HERE
        });

        return res.json(personalizedPosts);
      }
    }

    // SCENARIO B: User is logged out, or has joined 0 communities -> Global fallback feed
    const globalPosts = await prisma.post.findMany({
      include: postDataIncludes,
      orderBy: orderByCondition // <--- APPLY DYNAMIC SORT HERE ALSO
    });

    return res.json(globalPosts);

  } catch (error) {
    console.error("FETCH POSTS ERROR:", error);
    res.status(500).json({ error: "Could not retrieve posts" });
  }
});

// GET POSTS BY COMMUNITY NAME (For r/[communityName] pages)
app.get('/api/communities/:name/posts', async (req, res) => {
  const { name } = req.params;
  try {
    const posts = await prisma.post.findMany({
      where: {
        community: {
          name: name
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comments: true } },
        author: true,
        community: true,
        comments: {
          orderBy: { createdAt: 'desc' },
          include: { author: true }
        }
      }
    });
    res.json(posts);
  } catch (error) {
    console.error("COMMUNITY POSTS ERROR:", error);
    res.status(500).json({ error: "Could not fetch community posts" });
  }
});

// GET SINGLE POST BY ID
app.get('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const post = await prisma.post.findUnique({
      where: { id: Number(id) },
      include: {
        comments: { 
          orderBy: { createdAt: 'desc' },
          include: { author: true }
        },
        _count: { select: { comments: true } },
        author: true,
        community: true
      }
    });
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch post details" });
  }
});

// CREATE POST
app.post('/api/posts', async (req, res) => {
  const { title, content, imageUrl, author, communityName } = req.body;
if (!title || !content || !author || !communityName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const post = await prisma.post.create({
      data: {
        title,
        content,
        imageUrl: imageUrl || null, // Saves the URL string if provided, otherwise null
        author: { connect: { email: author } }, 
        community: { connect: { name: communityName } } 
      }
    });
    res.status(201).json(post);
  } catch (error) {
    console.error("POST ERROR:", error);
    res.status(500).json({ error: "User or Community not found." });
  }
});

// --- 2. COMMENT ROUTES ---

app.post('/api/posts/:id/comments', async (req, res) => {
  const { id } = req.params;
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required" });

  try {
    const comment = await prisma.comment.create({
      data: {
        text: text,
        post: { connect: { id: parseInt(id) } },
        author: { connect: { email: author || "mizaroob@gmail.com" } } 
      }
    });
    res.status(201).json(comment);
  } catch (error) {
    console.error("COMMENT ERROR:", error);
    res.status(500).json({ error: "Ensure user exists and post ID is valid." });
  }
});

// --- 3. OTHER ROUTES ---

// example of a secure DELETE route
app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { userEmail } = req.body; // Pass the email from the frontend session

  try {
    // 1. Find the post first
    const post = await prisma.post.findUnique({
      where: { id: Number(id) },
      include: { author: true }
    });

    if (!post) return res.status(404).json({ error: "Post not found" });

    // 2. Check if the user email matches the author email
    if (post.author.email !== userEmail) {
      return res.status(403).json({ error: "You don't have permission to delete this!" });
    }

    // 3. If it matches, delete
    await prisma.post.delete({ where: { id: Number(id) } });
    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.patch('/api/posts/:id/vote', async (req, res) => {
  const { id: postId } = req.params;
  const { voteType, userEmail } = req.body; // <--- Now accepting userEmail from session

  if (!userEmail) {
    return res.status(401).json({ error: "You must be logged in to vote" });
  }

  try {
    // 1. Find the user first to get their database ID
    const user = await prisma.user.findUnique({
      where: { email: userEmail }
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const pId = parseInt(postId);
    const uId = user.id;
    const targetType = voteType.toUpperCase(); // Standardizes to "UP" or "DOWN"

    // 2. Check if this specific user already voted on this specific post
    const existingVote = await prisma.vote.findUnique({
      where: {
        userId_postId: { userId: uId, postId: pId }
      }
    });

    let voteChange = 0;

    if (existingVote) {
      if (existingVote.type === targetType) {
        // Clicking the same arrow again un-votes (removes the vote entry)
        await prisma.vote.delete({
          where: { id: existingVote.id }
        });
        voteChange = targetType === "UP" ? -1 : 1;
      } else {
        // Changing mind (switching from DOWNvote to UPvote, or vice-versa)
        await prisma.vote.update({
          where: { id: existingVote.id },
          data: { type: targetType }
        });
        voteChange = targetType === "UP" ? 2 : -2; // Net balance shift of 2 units
      }
    } else {
      // Brand new vote entry
      await prisma.vote.create({
        data: {
          type: targetType,
          userId: uId,
          postId: pId
        }
      });
      voteChange = targetType === "UP" ? 1 : -1;
    }

    // 3. Update the total numeric score on the Post model
    const updatedPost = await prisma.post.update({
      where: { id: pId },
      data: {
        votes: { increment: voteChange }
      }
    });

    res.json({ votes: updatedPost.votes });
  } catch (error) {
    console.error("VOTING ROUTE ERROR:", error);
    res.status(500).json({ error: "Vote registration failed" });
  }
});

app.get('/api/communities', async (req, res) => {
  try {
    const communities = await prisma.community.findMany();
    res.json(communities);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch communities" });
  }
});

app.post('/api/communities', async (req, res) => {
  const { name, description } = req.body;
  try {
    const community = await prisma.community.create({
      data: {
        name: name.toLowerCase().replace(/\s+/g, '-'),
        description: description
      }
    });
    res.status(201).json(community);
  } catch (error) {
    res.status(400).json({ error: "Community name might already exist" });
  }
});

app.post('/api/users/register', async (req, res) => {
  const { email, password, username } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, username, password: hashedPassword }
    });
    res.status(201).json({ message: "User created!", userId: user.id });
  } catch (error) {
    res.status(400).json({ error: "User already exists" });
  }
});

app.post('/api/users/login-check', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && await bcrypt.compare(password, user.password)) {
    const { password: _, ...userWithoutPassword } = user;
    return res.json(userWithoutPassword);
  }
  res.status(401).json({ error: "Invalid credentials" });
});

// Fetch posts for a specific community
app.get('/api/communities/:name/posts', async (req, res) => {
  const { name } = req.params;
  try {
    const posts = await prisma.post.findMany({
      where: {
        community: {
          name: name // Filters posts by the community name in the URL
        }
      },
      include: {
        author: true,
        community: true,
        _count: { select: { comments: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch community posts" });
  }
});

// 1. Get comments for a specific post
app.get('/api/posts/:postId/comments', async (req, res) => {
  const { postId } = req.params;
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: parseInt(postId) },
      include: { 
        author: {
          select: { email: true, username: true } // Only send necessary user info
        } 
      },
      orderBy: { createdAt: 'asc' } // Oldest comments first (standard thread style)
    });
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch comments" });
  }
});

// 2. Create a new comment
app.post('/api/comments', async (req, res) => {
  const { content, postId, authorEmail } = req.body;
  
  try {
    // First, find the user ID based on the email from the session
    const user = await prisma.user.findUnique({ where: { email: authorEmail } });
    
    if (!user) return res.status(404).json({ error: "User not found" });

    const newComment = await prisma.comment.create({
      data: {
        content: content,
        postId: parseInt(postId),
        authorId: user.id
      },
      include: { author: true }
    });
    res.json(newComment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

app.delete('/api/comments/:commentId', async (req, res) => {
  const { commentId } = req.params;
  const { userEmail } = req.body; // <--- CHANGE 'body' TO 'req.body' // We pass the email to verify ownership

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: parseInt(commentId) },
      include: { author: true }
    });

    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // Ownership Check
    if (comment.author.email !== userEmail) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }

    await prisma.comment.delete({
      where: { id: parseInt(commentId) }
    });

    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// GET SINGLE COMMUNITY DETAILS
app.get('/api/communities/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const community = await prisma.community.findUnique({
      where: { name: name.toLowerCase() },
      include: {
        members: {
          select: { email: true } // Only pull emails to check membership status safely
        },
        _count: { select: { members: true } }
      }
    });
    if (!community) return res.status(404).json({ error: "Community not found" });
    res.json(community);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch community details" });
  }
});

// JOIN A COMMUNITY
app.post('/api/communities/:name/join', async (req, res) => {
  const { name } = req.params;
  const { userEmail } = req.body;

  if (!userEmail) return res.status(401).json({ error: "Please log in first" });

  try {
    const updatedCommunity = await prisma.community.update({
      where: { name: name.toLowerCase() },
      data: {
        members: {
          connect: { email: userEmail }
        }
      },
      include: { _count: { select: { members: true } } }
    });

    res.json({ message: `Joined r/${name} successfully`, memberCount: updatedCommunity._count.members });
  } catch (error) {
    console.error("JOIN COMMUNITY ERROR:", error);
    res.status(500).json({ error: "Could not join community" });
  }
});

// LEAVE A COMMUNITY
app.post('/api/communities/:name/leave', async (req, res) => {
  const { name } = req.params;
  const { userEmail } = req.body;

  if (!userEmail) return res.status(401).json({ error: "Please log in first" });

  try {
    const updatedCommunity = await prisma.community.update({
      where: { name: name.toLowerCase() },
      data: {
        members: {
          disconnect: { email: userEmail }
        }
      },
      include: { _count: { select: { members: true } } }
    });

    res.json({ message: `Left r/${name} successfully`, memberCount: updatedCommunity._count.members });
  } catch (error) {
    console.error("LEAVE COMMUNITY ERROR:", error);
    res.status(500).json({ error: "Could not leave community" });
  }
});

// GET USER PROFILE OVERVIEW BY USERNAME
app.get('/api/users/:username', async (req, res) => {
  const { username } = req.params;

  try {
    // 1. Fetch user by username along with their posts and joined communities
    const userProfile = await prisma.user.findUnique({
      where: { username: username },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        // Pull all posts this user authored
        posts: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: true,
            community: true,
            _count: { select: { comments: true } }
          }
        },
        // Pull all subreddits this user has joined
        communities: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!userProfile) {
      return res.status(404).json({ error: "User profile not found" });
    }

    res.json(userProfile);
  } catch (error) {
    console.error("PROFILE FETCH ERROR:", error);
    res.status(500).json({ error: "Could not retrieve user profile" });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));