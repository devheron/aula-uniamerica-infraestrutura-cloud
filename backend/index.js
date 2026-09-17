const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

// Inicializando o app Express
const app = express();
const { v4: uuidv4 } = require('uuid');

// Middleware de logging estruturado
app.use((req, res, next) => {
  const requestId = uuidv4();
  const start = Date.now();

  req.requestId = requestId;

  res.on('finish', () => {
    const log = {
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      environment: 'production',
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId: requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      duration_ms: Date.now() - start,
      userAgent: req.get('user-agent') || '',
      origin: req.get('origin') || ''
    };

    console.log(JSON.stringify(log));
  });

  next();
});
//const port = 5000;
const port = process.env.PORT || 8080;

// Conexão com o MongoDB (com autenticação)
/*mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Conectado ao MongoDB'))
  .catch((err) => console.error('Erro ao conectar ao MongoDB:', err));
*/
// Middleware para habilitar CORS e processar JSON
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000'
}));
app.use(bodyParser.json());

// Definindo o modelo de Tarefa (To-do)
const TodoSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
});

const Todo = mongoose.model('Todo', TodoSchema);

// Rota para obter todas as tarefas (GET)
app.get('/todos', async (req, res) => {
  const dbStart = Date.now();
  try {
    const todos = await Todo.find();
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'info',
      event: 'db_query',
      operation: 'find',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      resultCount: todos.length,
      requestId: req.requestId
    }));
    res.json(todos);
  } catch (err) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'error',
      event: 'db_error',
      operation: 'find',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      errorType: err.name,
      errorMessage: err.message,
      requestId: req.requestId
    }));
    res.status(500).json({ message: err.message });
  }
});

// Rota para adicionar uma nova tarefa (POST)
app.post('/todos', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ message: 'O campo "text" é obrigatório' });
  }

  const todo = new Todo({ text, completed: false });
  const dbStart = Date.now();

  try {
    const newTodo = await todo.save();
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'info',
      event: 'db_query',
      operation: 'save',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      requestId: req.requestId
    }));
    res.status(201).json(newTodo);
  } catch (err) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'error',
      event: 'db_error',
      operation: 'save',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      errorType: err.name,
      errorMessage: err.message,
      requestId: req.requestId
    }));
    res.status(400).json({ message: err.message });
  }
});

// Rota para marcar uma tarefa como concluída (PATCH)
app.patch('/todos/:id', async (req, res) => {
  const dbStart = Date.now();
  try {
    const todo = await Todo.findById(req.params.id);

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    todo.completed = !todo.completed;
    await todo.save();

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'info',
      event: 'db_query',
      operation: 'update',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      requestId: req.requestId
    }));

    res.json(todo);
  } catch (err) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'error',
      event: 'db_error',
      operation: 'update',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      errorType: err.name,
      errorMessage: err.message,
      requestId: req.requestId
    }));
    res.status(500).json({ message: err.message });
  }
});

// Rota para excluir uma tarefa (DELETE)
app.delete('/todos/:id', async (req, res) => {
  const dbStart = Date.now();
  try {
    const todo = await Todo.findByIdAndDelete(req.params.id);

    if (!todo) {
      return res.status(404).json({ message: 'Tarefa não encontrada' });
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'info',
      event: 'db_query',
      operation: 'delete',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      requestId: req.requestId
    }));

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (err) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'todo-backend',
      level: 'error',
      event: 'db_error',
      operation: 'delete',
      collection: 'todos',
      duration_ms: Date.now() - dbStart,
      errorType: err.name,
      errorMessage: err.message,
      requestId: req.requestId
    }));
    res.status(500).json({ message: err.message });
  }
});

// Iniciando o servidor na porta 5000
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
  .then(() => console.log('Conectado ao MongoDB'))
  .catch((err) => console.error('Erro ao conectar ao MongoDB:', err.message));